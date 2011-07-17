#!/usr/bin/env python
# -*- coding: utf-8 -*-

import socket
import struct
import hashlib
import SocketServer
import Queue
import select
import threading

DEFAULT_PORT = 9876

class WebSocketServer(SocketServer.TCPServer):
    def __init__(self, *args, **kwargs):
        self.allow_reuse_address = True
        SocketServer.TCPServer.__init__(self, *args, **kwargs)
        self.sendToClientQueue = Queue.Queue(maxsize=1024)
        self.receiveFromClientQueue = Queue.Queue(maxsize=1024)
        print self.server_address
        
    def getFromClient(self, timeout=1):
        self.receiveFromClientQueue.get(timeout)
    
    def sendToClient(self, message):
        """
        Message must be JSON encoded
        """
        try:
            self.sendToClientQueue.put(message)
        except Queue.Full:
            pass
    
    def _server_to_client(self):
        """Called by webSocketHandler to send to client the needed data."""
        return self.sendToClientQueue.get(timeout=0.1)
    
    def _client_to_server(self, message):
        """Called by webSocketHandler to send to server data."""
        try:
            return self.receiveFromClientQueue.put(message)
        except Queue.Full:
            pass

class BackgroundWebSocketServer(threading.Thread):
    def __init__(self, *args, **kwargs):
        threading.Thread.__init__(self)
        self.setDaemon(True)
        self.setName("WebSocket")
        
        self.server = WebSocketServer(*args, **kwargs)
    
    def run(self):
        self.server.serve_forever()

class WebSocketHandler(SocketServer.BaseRequestHandler):
    def create_handshake_resp(self, handshake):
        final_line = ""
        lines = handshake.splitlines()
        key1 = ""
        key2 = ""
        host = ""
        origin = ""
        print "Lines: %s" % (lines,)
        for line in lines:
            parts = line.partition(": ")
            if parts[0] == "Sec-WebSocket-Key1":
                key1 = parts[2]
            elif parts[0] == "Sec-WebSocket-Key2":
                key2 = parts[2]
            elif parts[0] == "Host":
                host = parts[2]
            elif parts[0] == "Origin":
                origin = parts[2]
            final_line = line

        spaces1 = key1.count(" ")
        spaces2 = key2.count(" ")
        num1 = int("".join([c for c in key1 if c.isdigit()])) / spaces1
        num2 = int("".join([c for c in key2 if c.isdigit()])) / spaces2

        token = hashlib.md5(struct.pack('>II8s', num1, num2, final_line)).digest()

        return (
            "HTTP/1.1 101 WebSocket Protocol Handshake\r\n"
            "Upgrade: WebSocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Origin: %s\r\n"
            "Sec-WebSocket-Location: ws://%s/\r\n"
            "\r\n"
            "%s") % (
            origin, host, token)

    def handle(self):
        print "Client connected."
        data = self.request.recv(1024)
        print "Sending handshake..."
        self.request.send(self.create_handshake_resp(data))
        print "Ok, loop..."
        while True:
            try:
                message = self.server._server_to_client()
            except Queue.Empty:
                message = None
            
            if message:
                self.request.send("\x00"+message+"\xff")
            
            #~ rfds, wfds, efds = select.select([self.request,],[],[], 0.001)
            #~ if self.request in rfds:
                #~ # Read 1 block
                #~ block = None
                #~ tmp = []
                #~ while not block:
                    #~ c = self.request.recv(1)
                    #~ if not c:
                        #~ print "Client disconnects."
                        #~ return
                    #~ if c == "\x00":
                        #~ tmp = []
                    #~ elif c == "\xff":
                        #~ block = ''.join(tmp)
                    #~ else:
                        #~ tmp.append(c)
                #~ if block:
                    #~ self.server._client_to_server(block)
                #~ print "End Reading block."
        print "Client disconnected."
    
if __name__ == "__main__":
    server = WebSocketServer(("0.0.0.0", DEFAULT_PORT), WebSocketHandler)
    server.serve_forever()
