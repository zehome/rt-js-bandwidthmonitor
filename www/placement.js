/* May needed to be tweeked a little bit to get accuracy */
const max_packets_per_flux = 500; 

/* Flux line constants */
const initial_flux_line_size = 1;
const max_flux_line_size = 40;

/* Flux table refresh time in millisec */
var fluxtable_refresh_time = 2000;

/* The node/fluxs attached will be deleted after that amount of time. */
var node_inactivity_timeout = 60 * 1000;

/* Average bandwidth calc time in millisec */
var bandwidth_average_time = 1000; /* 1s avg bandwidth max */

/* Global constants for raphaelJS & websocket */
var paper = null;
var ws = null;

/* Initialization sizes */
var total_width = 600;
var total_height = 600;

/* Node size */
var _minimum_radius = 5;

/* Global storage */
var nodes = [];
var fluxs = [];

/* Some utility constants */
const unit_gigabyte = 1024*1024*1024;
const unit_megabyte = 1024*1024;
const unit_kilobyte = 1024;

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

function initialize()
{
    paper = Raphael("canvas", total_width, total_height);
    nodes = [];
    fluxs = [];
}

function pretty_bandwidth(bytes)
{
    var value = bytes;
    var unit = "B/s";
    if (bytes >= unit_gigabyte)
    {
        value = bytes / unit_gigabyte;
        unit = "GiB/s";
    } else if (bytes >= unit_megabyte) {
        value = bytes / unit_megabyte;
        unit = "MiB/s";
    } else if (bytes >= unit_kilobyte) {
        value = bytes / unit_kilobyte;
        unit = "KiB/s";
    }
    return value.toFixed(2) + " " + unit;
}

function Flux(src, dst)
{
    var flux = {
        src: src,
        dst: dst,
        src_name: src.title,
        dst_name: dst.title,
        total_bytes: 0,
        total_packets: 0,
        packets: [],
        drawing: null,
        idle: true,
        timeout_checker: null,
        add_packet: function(pkt) 
        {
            this.idle = false;
            this.total_packets += 1;
            this.total_bytes += pkt.length;
            if (this.packets.length > max_packets_per_flux)
            {
                this.packets.splice(0, 50);
            }
            this.packets.push({
                time: pkt.time,
                length: pkt.length
            });
            this.animate(pkt);
        },
        animate: function(pkt)
        {
            if (this.drawing && !this.idle)
            {
                var hideOut = function(flux) 
                { 
                    return function() { 
                        flux.hide(); 
                        flux.idle = true;
                    }
                }; 
                
                var animateOut = function(flux) 
                {
                    return function() 
                    {
                        flux.drawing.stop().animate({
                            "stroke-width": initial_flux_line_size,
                            "stroke-opacity": 0.4
                        }, 100, function() 
                            {
                                flux.drawing.stop().animate({
                                    "stroke-opacity": 0
                                }, 3000, hideOut);
                                flux.idle = true;
                            }
                        );
                    };
                };
                
                if (pkt)
                {
                    this.drawing.stop().animate({
                        "stroke-opacity": 1,
                        "stroke-width": 10
                    }, 150, animateOut(this));
                } else {
                    animateOut(this)();
                }
            }
        },
        get_bandwidth: function()
        {
            var pkts = this.packets.slice().reverse();
            if (pkts.length > 2)
            {
                var now = new Date().getTime();
                var bytes = 0;
                //var max_end_time = pkts[0].time - bandwidth_average_time;
                var max_end_time = now - bandwidth_average_time;
                var pkt = null;
                for (var i = 0; i < pkts.length; i++)
                {
                    pkt = pkts[i];
                    /* Too much packets */
                    if (pkt.time <= max_end_time)
                        break;
                    bytes += pkt.length;
                }
                //console.log("Amount of data time: "+ (pkts[0].time - pkts[i].time)+ " in " + i + " packets.");
                //console.log("From "+pkts[i].time+" to "+pkts[0].time+ " : " + bytes + " bytes.");
                
                if (pkt && ((now - pkt.time) != 0)) {
                    return (bytes / (now - pkt.time))*1000;
                } else {
                    return 0;
                }
            } else {
                return 0;
            }
        },
        remove: function()
        {
            if (this.drawing)
            {
                this.drawing.hide();
                this.drawing.remove();
            }
            for (var i = 0; i < fluxs.length; i++)
            {
                var f = fluxs[i];
                if (f == this)
                {
                    fluxs.remove(i);
                    break;
                }
            }
        },
        redraw: function()
        {
            if (this.drawing)
            {
                this.drawing.stop();
                this.drawing.hide();
                this.drawing.remove();
            }
            
            this.drawing = paper.path("M"+this.src.x+" "+this.src.y+
                " L"+dst.x+" "+dst.y);
            this.drawing.attr({
                "stroke": "green", 
                "stroke-width": initial_flux_line_size,
                "stroke-opacity": 0.4
            });
            
            if (this.idle) {
                this.drawing.attr({"stroke-opacity": 0});
            } else {
                this.drawing.show();
                this.animate(null);
            }
        }
    };
    
    /* Register the flux to nodes */
    dst.fluxs.push(flux);
    src.fluxs.push(flux);
    
    fluxs.push(flux);
    
    return flux;
}

function get_flux(src, dst)
{
    for (var i = 0; i < fluxs.length; i++)
    {
        var flux = fluxs[i];
        if (flux.src == src && flux.dst == dst)
            return flux;
    }
    return null;
}

function Node(name)
{
    var node = {
        title: name,
        text_angle: 0,
        text: null,
        x: 0,
        y: 0,
        text_x: 0,
        text_y: 0,
        reference: null,
        fillcolor: "red",
        radius: _minimum_radius,
        timeout_checker: null,
        fluxs: [],
        setposition: function(x, y, angle_rad)
        {
            this.x = x;
            this.y = y;
            
            this.text_x = this.x + (40 * Math.cos(angle_rad));
            this.text_y = this.y + (40 * Math.sin(angle_rad));
            
            this.text_angle = (180*angle_rad)/Math.PI;
            if (this.text_angle > 90 && this.text_angle <= 180)
                this.text_angle -= 180;
            else if (this.text_angle > 180 && this.text_angle <= 270)
                this.text_angle -= 180;
        },
        redraw: function()
        {
            if (this.reference)
            {
                this.reference.hide();
                this.reference.remove();
            }
            
            this.reference = paper.circle(this.x, this.y, this.radius);
            this.reference.attr("fill", this.fillcolor);
            this.reference.show();

            if (this.text)
            {
                this.text.hide();
                this.text.remove();
            }
            
            this.text = paper.text(this.text_x, this.text_y, this.title);
            this.text.attr("fill", "white");
            this.text.rotate(this.text_angle);
            this.text.show();
        },
        remove: function()
        {
            if (this.timeout_checker)
                clearTimeout(this.timeout_checker);
            
            /* Remove referenced flux */
            this.fluxs.forEach(function(flux) {
                flux.remove();
            });
            
            /* Loop through all nodes and remove me */
            var found=false;
            for (var i = 0; i < nodes.length; i++)
            {
                var xnode = nodes[i];
                if (xnode.title == this.title)
                {
                    found=true;
                    console.log("Real remove node " + this.title);
                    nodes.remove(i);
                    break;
                }
            };
            if (! found)
            {
                var nodes_t = [];
                for (var i = 0; i < nodes.length; i++) {
                    nodes_t.push(nodes[i].title);
                }
                console.log("Node " + node.title + " not found in nodes: " + nodes_t.join(" "));
            }
            /* Just dereference raphaelJS graphics */
            if (this.reference)
            {
                this.reference.hide();
                this.reference.remove();
            }
            if (this.text)
            {
                this.text.hide();
                this.text.remove();
            }

            delete(this);
            
            /* updates the drawing */
            redraw();
        }
    };
    
    var tick = function(node) 
    {
        /* Reset timeout */
        if (node.timeout_checker)
            clearTimeout(node.timeout_checker);
        node.timeout_checker = setTimeout(function(){ 
            node.remove();
        }, node_inactivity_timeout);
    };
    node.tick = function() { tick(node); }; 
    
    node.tick();
    //console.debug("Added node: "+name+".");
    nodes.push(node);
    return node;
}

function redraw()
{
    //paper.clear();
    recalc_nodes_position();
    nodes.forEach(function(node) { node.redraw(); });
    fluxs.forEach(function(flux) { flux.redraw(); });
}

function recalc_nodes_position()
{
    var center_x = total_width / 2;
    var center_y = total_height / 2;
    var distance = 200;
    var text_distance = distance + 30;
    var initialAngle = 0;
    
	var step = (2 * Math.PI) / nodes.length;
	var angle = initialAngle;
	nodes.forEach(function(node) 
    { 
		if (distance < 0)
            distance = node.radius+10 / Math.sin(step);
		var x = center_x + distance * Math.cos(angle);
		var y = center_y + distance * Math.sin(angle);
        node.setposition(x, y, angle);
		angle += step;
	});
}

function refresh_flux_table()
{
    var tableData = []
    for (var i = 0; i < fluxs.length; i++)
    {
        var flux = fluxs[i];
        tableData.push([
            flux.src_name,
            flux.dst_name,
            flux.total_packets,
            flux.total_bytes,
            flux.get_bandwidth()
        ]);
    }
    
    var table = $("#fluxtable").dataTable();
    table.fnClearTable();
    table.fnAddData(tableData);
}

function handle_pkt(e)
{
    var pkt = JSON.parse(e.data);
    
    /* Identify the node or create it */
    var src_node = null;
    var dst_node = null;
    for (var i = 0; i < nodes.length; i++)
    {
        var node = nodes[i];
        if (node.title == pkt.src)
            src_node = node;
        
        if (node.title == pkt.dst)
            dst_node = node;
        
        if (src_node && dst_node)
            break;
    }
    
    if (!src_node)
    {
        src_node = new Node(pkt.src);
        redraw();
    }
    if (!dst_node)
    {
        dst_node = new Node(pkt.dst);
        redraw();
    }
    src_node.tick();
    dst_node.tick();
    
    /* Handle flux */
    var flux = get_flux(src_node, dst_node);
    if (! flux)
    {
        flux = new Flux(src_node, dst_node);
        flux.redraw();
    }
    flux.add_packet(pkt);
    
    //~ if (flux.packets.length > 500)
    //~ {
        //~ var bw = flux.get_bandwidth();
        //~ if (bw > 3*1024)
        //~ {
            //~ console.log("Flux "+flux.src.title+"->"+flux.dst.title+": "+pretty_bandwidth(bw));
        //~ }
    //~ }
    
    /* Show packet transmission */
    //~ var c = paper.circle(src_node.x, src_node.y, 2);
    //~ c.attr("fill", "green");
    //~ c.animate({
        //~ "cx": dst_node.x, 
        //~ "cy": dst_node.y}, 300);
    //~ setTimeout(function () { c.hide(); c.stop(); }, 300);
    
    //~ var p = paper.path("M"+src_node.x+" "+src_node.y+" L"+dst_node.x+" "+dst_node.y);
    //~ p.attr({stroke: "green", "stroke-width": 3});
    //~ p.animate({"stroke-opacity": 0, "stroke-width": 0}, 300);
}

function strip_ipv6(ip)
{
    var splitted = ip.split(":");
    
    if (splitted.length > 5 && ip.length > 17)
    {
        //console.log("ip "+ ip + " splitted " +splitted);
        var output = []
        
        output = output.concat(splitted.splice(0,2));
        output.push(["..."]);
        output = output.concat(splitted.splice(-2));
        
        return output.join(":");
    } else {
        return ip;
    }
}

/* Browser DOM onload */
window.onload = function()
{
    initialize();

    ws = new WebSocket("ws://192.168.6.2:9876/");
    //ws = new WebSocket("ws://appart.zehome.com:9876/");
    ws.onopen = function() { console.log("Connected to websocket server."); };
    ws.onmessage = handle_pkt;
    ws.onerror = function(e) { console.log("E: "+e); };
    ws.onclose = function(e) { console.log("Closed: "+e); };
    redraw();
    
    /* Initialize Flux Table */
    $("#fluxtable").dataTable( {
        "aLengthMenu": [20, 100, -1],
        "iDisplayLength": 20,
        "bJQueryUI": true,
        "aoColumns": [
            { "sTitle": "Source" },
            { "sTitle": "Destination" },
            { "sTitle": "Packets" },
            { "sTitle": "Bytes" },
            { "sTitle": "Bandwidth" },
        ],
        "aoColumnDefs": [
            { 
                "aTargets": [4],
                "fnRender": function (oObj) 
                { 
                    return pretty_bandwidth(oObj.aData[4]); 
                }
                
            },
            { 
                "aTargets": [0],
                "fnRender": function (oObj) 
                { 
                    return strip_ipv6(oObj.aData[0]); 
                }
            },
            { 
                "aTargets": [1],
                "fnRender": function (oObj) 
                { 
                    return strip_ipv6(oObj.aData[1]);
                },
            },
            {
                "aTargets": [2,3,4],
                "sClass": "right",
                "bUseRendered": false
            }
        ]
    });
    
    setInterval(refresh_flux_table, fluxtable_refresh_time);
};