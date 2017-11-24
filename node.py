# -*- conding: utf-8 -*-

"""
This is part of the rtjsbandwidthmonitor project
node.py must be run as root.

What node.py does is that it sniff the network on specified interface with pcap
then it drops it's privileges and starts to process packets
for use in a the "javascript" part of this project.

(c) 2011 Laurent COUSTET
http://ed.zehome.com/
"""

class NodeException(Exception): pass
class NodePcapException(NodeException): pass

class Flux(object):
    _total_pkt_size = 0L
    _total_pkt_count = 0L
    _src = None
    _dst = None
    _last_seen = 0
    
    def __init__(self, src, dst):
        self._src = src
        self._dst = dst
    
    def update(self, pkt):
        self._total_pkt_count += 1
        self._total_pkt_size += len(pkt)
        self._last_seen = time.time()

    def __cmp__(a, b):
        return cmp(a._total_pkt_count, b._total_pkt_count)
        #~ r = cmp(a._src, b._src)
        #~ if r == 0:
            #~ r = cmp(a._dst, b._dst)
            #~ if r == 0:
                #~ r = cmp(a._total_pkt_count, b._total_pkt_count)
        #~ return r
    
    @property
    def _avg_pkt_size(self):
        if not self._total_pkt_count:
            return 0
        else:
            return (self._total_pkt_size / self._total_pkt_count)
    
    def __unicode__(self):
        return "%s -> %s [%s packets] of %s bytes average" % (
            self._src, self._dst, self._total_pkt_count,
            self._avg_pkt_size
        )

class HostMap(object):
    _flux = {}
    
    def flush(self):
        self._flux = {}
    
    def update(self, src, dst, pkt):
        """hash src/dst to match a _flux or create it."""
        h = hash(src+dst)
        flux = self._flux.get(h, None)
        if not flux:
            flux = self._flux[h] = Flux(src, dst)
        flux.update(pkt)
    
    def __unicode__(self):
        table = texttable.Texttable()
        
        table.set_cols_align(["l", "l", "r", "r"])
        table.set_cols_valign(["t", "t", "t", "t"])
        table.header(["Source", "Destination", "Total packets", "Average packet size"])
        
        fluxs = self._flux.values()
        fluxs.sort()
        fluxs.reverse()
        
        table.add_rows([ (f._src, f._dst, f._total_pkt_count, f._avg_pkt_size) for f in \
            fluxs ], header=False)
        
        return table.draw()

class Dispatcher(object):
    def __init__(self, ws):
        self.hostmap = HostMap()
        self.websocket = ws
        self.total_pkt_counter = 0
    
    def push_websocket(self, dict):
        self.websocket.send(json.dumps(dict))
    
    def pypcap_dispatch_callback(self, timestamp, pkt, *args, **kw):
        self.total_pkt_counter += 1
        
        try:
            ether_pkt = dpkt.ethernet.Ethernet(pkt)
        except:
            return
        
        pkttype = None
        ip_pkt = None
        pktdata = ether_pkt.data
        if isinstance(pktdata, dpkt.ip.IP):
            pkttype = "IP4"
        elif isinstance(pktdata, dpkt.ip6.IP6):
            pkttype = "IP6"
        
        if pkttype in ("IP4", "IP6"):
            ip_pkt = pktdata
            if isinstance(pktdata.data, dpkt.tcp.TCP):
                if pkttype == "IP6":
                    pkttype = "TCP6"
                else:
                    pkttype = "TCP"
                pktdata = pktdata.data
            elif isinstance(pktdata.data, dpkt.udp.UDP):
                if pkttype == "IP6":
                    pkttype = "UPD6"
                else:
                    pkttype = "UDP"
                pktdata = pktdata.data
            elif isinstance(pktdata.data, dpkt.icmp.ICMP):
                pkttype = "ICMP"
                pktdata = pktdata.data
            elif isinstance(pktdata.data, dpkt.icmp6.ICMP6):
                pkttype = "ICMP6"
                pktdata = pktdata.data
            
        if pkttype in ("TCP", "TCP6", "UDP", "UDP6", "ICMP", "ICMP6"):
            if isinstance(ip_pkt, dpkt.ip.IP):
                familly = socket.AF_INET
            else:
                familly = socket.AF_INET6
            
            # We want to discard "websocket" packets ;)
            if pkttype in ("TCP", "TCP6"):
                ignore_port = 9876
                if (pktdata.sport == ignore_port or pktdata.dport == ignore_port):
                    return
            
            src = socket.inet_ntop(familly, ip_pkt.src)
            dst = socket.inet_ntop(familly, ip_pkt.dst)
            self.hostmap.update(src, dst, pktdata)
            #~ print "[%s] %s => %s (%s)" % (pkttype, src, dst, len(pktdata))
            self.push_websocket({
                "src": src,
                "dst": dst,
                "pkttype": pkttype,
                "length": len(pktdata),
                "time": int(time.time()*1000),
            })
        else:
            print "Unknown packet: %s" % (pktdata.__class__.__name__,)
        
        if self.total_pkt_counter % 6500 == 0:
            print unicode(self.hostmap)

def start_pcap(interface):
    """Critical part for security: needs root privileges."""    
    try:
        pc = pcap.pcap(interface)
    except:
        raise NodePcapException(
            "Unable to start pcap on interface %s: %s" % (
                interface, traceback.format_exc(),)
        )
    return pc

def drop_privileges(uid, gid, groups):
    try:
        return privilege.drop_privileges_permanently(uid, gid, groups)
    except privilege.PrivilegeFail:
        raise NodeException("Unable to drop privileges: %s" % (
            traceback.format_exc(),))

if __name__ == "__main__":
    try:
        import pcap # BSD licence
    except ImportError:
        print "python-pypcap must be installed on your computer."
        sys.exit(0)

    import privilege

    import os
    from optparse import OptionParser, OptionGroup
    
    parser = OptionParser()
    
    parser.add_option("-i", "--interface", dest="interface", 
        help="Interface to sniff. eg: eth0, eth1, ...")
    parser.add_option("-v", "--verbose", dest="verbose", 
        action="store_true",
        help="Print more stuff on the console.")
    parser.add_option("-p", "--promisc", dest="promisc",
        action="store_true",
        help="Turn on promisc mode.")
    
    group = OptionGroup(parser, "Security options")
    group.add_option("-u", "--uid", dest="uid",
        help="uid on which the daemon will drop it's privileges.")
    group.add_option("-g", "--gid", dest="gid",
        help="gid on which the daemon will drop it's privileges.")
    parser.add_option_group(group)
    
    group = OptionGroup(parser, "Websocket server options",
        """Thoses options controls the websocket server embedded""")
    group.add_option("--port", dest="port",
        help="Port to listen to for websocket server",
        type="int")
    group.add_option("--host", dest="host",
        help="Host to listen to for websocket server")
    parser.add_option_group(group)
    
    parser.set_defaults(verbose=True)
    parser.set_defaults(port=9876)
    parser.set_defaults(host=None)
    parser.set_defaults(gid="nogroup")
    parser.set_defaults(uid="nobody")
    parser.set_defaults(interface="eth0")
    parser.set_defaults(promisc=True)
    
    try:
        (options, args) = parser.parse_args()
    except:
        parser.print_help()
        sys.exit(0)
    
    try:
        pc = start_pcap(options.interface)
    except NodePcapException, e:
        if os.getuid() == 0:
            raise
        else:
            print("Unable to listen on interface %s. You should run this script as root!" \
                % (options.interface,))
            sys.exit(1)
    else:
        drop_privileges(options.uid, options.gid, [])

    # LC: Must do dynamic import After dropping privileges
    import sys
    import traceback
    import struct
    import socket
    import time
    import texttable # LGPL licence
    import json
    import websocket
    
    try:
        import dpkt # Python licence
    except ImportError:
        print "python-dpkt must be installed on your computer."
        sys.exit(0)

    ws = websocket.WebSocket()
    ws.connect("ws://127.0.0.1:9876")
    dispatcher = Dispatcher(ws)
    
    print "Currently listening for packets on interface %s." % (options.interface,)
    pc.loop(0, dispatcher.pypcap_dispatch_callback)
    print "Exiting."
    pc.close()
    sys.exit(0)
