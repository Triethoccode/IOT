'use strict';
// Minimal MQTT 3.1.1 QoS-0 broker for isolated integration tests only.
// Not an application broker: no network other than loopback, no persistence.
const net = require('node:net');
const mqttPacket = require('mqtt-packet');
const { EventEmitter } = require('node:events');
async function localBroker() {
  const events = new EventEmitter();
  const clients = new Map();
  const retained = new Map();
  function deliver(topic,payload,retain=false) {
    for(const [socket,subs] of clients) if(subs.has(topic)) socket.write(mqttPacket.generate({cmd:'publish',topic,payload,qos:0,retain}));
  }
  const server = net.createServer(socket=>{
    clients.set(socket,new Set());
    const parser=mqttPacket.parser(); socket.on('data',chunk=>parser.parse(chunk));
    parser.on('error',()=>socket.destroy()); socket.on('error',()=>{});
    socket.on('close',()=>clients.delete(socket));
    parser.on('packet',packet=>{
      if(packet.cmd==='connect') socket.write(mqttPacket.generate({cmd:'connack',returnCode:0,sessionPresent:false}));
      else if(packet.cmd==='subscribe') {
        for(const sub of packet.subscriptions) clients.get(socket).add(sub.topic);
        socket.write(mqttPacket.generate({cmd:'suback',messageId:packet.messageId,granted:packet.subscriptions.map(()=>0)}));
        for(const sub of packet.subscriptions) if(retained.has(sub.topic)) socket.write(mqttPacket.generate({cmd:'publish',topic:sub.topic,payload:retained.get(sub.topic),qos:0,retain:true}));
        events.emit('subscribe',packet.subscriptions);
      } else if(packet.cmd==='publish') {
        if(packet.retain) retained.set(packet.topic,packet.payload);
        deliver(packet.topic,packet.payload);
        events.emit('publish',packet);
      } else if(packet.cmd==='pingreq') socket.write(mqttPacket.generate({cmd:'pingresp'}));
      else if(packet.cmd==='unsubscribe') {
        for(const topic of packet.unsubscriptions) clients.get(socket).delete(topic);
        socket.write(mqttPacket.generate({cmd:'unsuback',messageId:packet.messageId}));
      } else if(packet.cmd==='disconnect') socket.end();
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {events,port:server.address().port,publish:deliver,retained,
    close:()=>new Promise(resolve=>{for(const socket of clients.keys())socket.destroy();server.close(resolve);})};
}
module.exports={localBroker};
