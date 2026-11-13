'use strict';
const {test} = require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {once}=require('node:events');
const {localBroker}=require('./helpers/local-broker');
const {ControlGateway}=require('../nodered_data/lib/control-gateway');
const {routeMessage}=require('../nodered_data/lib/route-message');

function waitFor(check,label,timeout=10000) {
  return new Promise((resolve,reject)=>{
    const end=Date.now()+timeout;
    const timer=setInterval(()=>{if(check()){clearInterval(timer);resolve();}else if(Date.now()>end){clearInterval(timer);reject(Error('Timeout: '+label));}},20);
  });
}
test('deployed Node-RED flow sends MQTT and matches ACK, then rejects Offline without publishing', {timeout:30000}, async()=>{
  const broker=await localBroker();
  const RED=require('node-red');
  const server=http.createServer();
  const userDir=path.resolve('tmp/nodered-integration'); fs.mkdirSync(userDir,{recursive:true});
  const nodes=JSON.parse(fs.readFileSync('nodered_data/flows.json','utf8'));
  const cfg=nodes.find(n=>n.type==='mqtt-broker'); cfg.broker='127.0.0.1';cfg.port=String(broker.port);
  fs.writeFileSync(path.join(userDir,'flows.json'),JSON.stringify(nodes));
  const gateway=new ControlGateway({verifyIdentity:(e,p)=>e==='test'&&p==='test'});
  RED.init(server,{userDir,flowFile:'flows.json',httpAdminRoot:false,httpNodeRoot:'/',
    nodesDir:path.resolve('node_modules'),credentialSecret:false,
    functionGlobalContext:{aeroDryControl:gateway,aeroDryRoute:routeMessage},
    logging:{console:{level:'error',metrics:false,audit:false}}});
  server.on('request',RED.httpNode);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const feedback=[]; const commands=[];
  broker.events.on('publish',packet=>{if(packet.topic.endsWith('/cmd'))commands.push(packet);});
  try {
    await RED.start();
    await waitFor(()=>RED.nodes.getNode('fn_linh_control_gateway'),'function load');
    RED.nodes.getNode('ui_stitch_webapp').on('input',msg=>feedback.push(msg));
    await waitFor(()=>gateway.brokerOnline,'MQTT connect');
    const heartbeat={device_id:'esp32_01',group_id:'G21_24C11',boot_id:'boot1',connection_id:1,status:'ONLINE'};
    broker.publish('aerodry/g21/esp32_01/heartbeat',JSON.stringify(heartbeat));
    await waitFor(()=>gateway.connection(Date.now()).online,'live heartbeat');
    const router=RED.nodes.getNode('fn_linh_control_gateway');
    router.receive({topic:'login_action',socketid:'browser-A',payload:{email:'test',password:'test'}});
    await waitFor(()=>feedback.some(m=>m.payload.kind==='auth'&&m.payload.ok),'auth feedback');
    router.receive({topic:'device_command',socketid:'browser-A',payload:{action:'SET_ROD',params:{target:'RETRACTED'}}});
    await waitFor(()=>commands.length===1,'MQTT command');
    const cmd=JSON.parse(commands[0].payload);
    assert.equal(commands[0].retain,false); assert.equal(commands[0].qos,0);
    broker.publish('aerodry/g21/esp32_01/ack',JSON.stringify({device_id:'esp32_01',boot_id:'boot1',connection_id:1,
      cmd_id:cmd.cmd_id,status:'ACCEPTED',reason:'OK',resulting_state:{rod_state:'RETRACTED'}}));
    await waitFor(()=>feedback.some(m=>m.payload.status==='ACCEPTED'),'ACK return to UI');
    const accepted=feedback.find(m=>m.payload.status==='ACCEPTED'); assert.equal(accepted.socketid,'browser-A');
    broker.publish('aerodry/g21/esp32_01/heartbeat',JSON.stringify({...heartbeat,status:'OFFLINE'}));
    await waitFor(()=>!gateway.connection(Date.now()).online,'LWT offline');
    router.receive({topic:'device_command',socketid:'browser-A',payload:{action:'RESET_COUNTER',confirmed:true}});
    await waitFor(()=>feedback.some(m=>m.payload.reason==='DEVICE_OFFLINE'),'offline rejection');
    assert.equal(commands.length,1);
  } finally {
    await RED.stop(); await broker.close(); await new Promise(resolve=>server.close(resolve));
  }
});
