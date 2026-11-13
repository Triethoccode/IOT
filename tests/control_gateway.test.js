'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { ControlGateway } = require('../nodered_data/lib/control-gateway');
const { routeMessage } = require('../nodered_data/lib/route-message');
const now = 1800000000000;
function setup() {
  let sequence = 0;
  const g = new ControlGateway({ verifyIdentity: (e,p) => e==='linh' && p==='secret', id:()=>`CMD_${++sequence}` });
  g.brokerOnline = true;
  g.login({socketid:'A',payload:{email:'linh',password:'secret'}},now);
  heartbeat(g,now);
  return g;
}
function heartbeat(g,time,patch={},retain=false) {
  return g.heartbeat({retain,payload:{device_id:'esp32_01',group_id:'G21_24C11',boot_id:'boot1',connection_id:1,status:'ONLINE',...patch}},time);
}
function command(g,patch={}) { return g.command({socketid:'A',payload:{action:'SET_ROD',params:{target:'RETRACTED'}},...patch},now+1); }
function ack(g,patch={}) { return {payload:{device_id:'esp32_01',boot_id:'boot1',connection_id:1,cmd_id:g.pending?.cmd_id,status:'ACCEPTED',reason:'OK',...patch}}; }

test('commands require an authenticated, unexpired per-client session',()=>{
  const g=setup(); assert.equal(command(g,{socketid:'B'}).feedback.payload.reason,'UNAUTHENTICATED');
  assert.equal(g.command({socketid:'A',payload:{}},now+3600000).feedback.payload.reason,'UNAUTHENTICATED');
});
test('login failures, logout and deploy never grant shared authorization',()=>{
  const g=setup(); assert.equal(g.login({socketid:'B',payload:{email:'linh',password:'bad'}},now).payload.ok,false);
  assert.equal(g.sessions.has('B'),false); g.login({socketid:'A',payload:{action:'LOGOUT'}},now);
  assert.equal(command(g).feedback.payload.reason,'UNAUTHENTICATED'); g.reset(); assert.equal(g.connection(now).online,false);
});
test('missing credentials adapter fails closed',()=>{
  const g=new ControlGateway(); assert.equal(g.login({socketid:'A',payload:{email:'x',password:'x'}},now).payload.ok,false);
});
test('local scrypt adapter accepts only the configured identity and exact password',()=>{
  const salt='a'.repeat(32), password='Mật khẩu demo 123';
  const hash=`${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;
  const g=new ControlGateway({email:'linh@example.test',passwordHash:hash});
  assert.equal(g.login({socketid:'A',payload:{email:'linh@example.test',password}},now).payload.ok,true);
  assert.equal(g.login({socketid:'B',payload:{email:'other',password}},now).payload.ok,false);
  assert.equal(g.login({socketid:'C',payload:{email:'linh@example.test',password:'wrong'}},now).payload.ok,false);
});
test('only live, correctly identified heartbeat marks device online',()=>{
  const g=setup(); g.device.online=false;
  for(const patch of [{device_id:'other'},{group_id:'other'},{is_simulation:true},{time_synced:true,timestamp:1}]) assert.equal(heartbeat(g,now,patch),false);
  assert.equal(heartbeat(g,now,{},true),false); assert.equal(g.connection(now).online,false);
  heartbeat(g,now); assert.equal(g.connection(now).online,true);
});
test('heartbeat expiry, LWT and broker disconnect close command path',()=>{
  const g=setup(); assert.equal(g.connection(now+25000).online,false);
  heartbeat(g,now,{status:'OFFLINE'}); assert.equal(command(g).feedback.payload.reason,'DEVICE_OFFLINE');
  heartbeat(g,now); routeMessage(g,{topic:'$broker',status:{text:'disconnected'}},now); assert.equal(command(g).feedback.payload.reason,'DEVICE_OFFLINE');
});
test('wire packet uses canonical topic, bounded TTL, connection nonce, no retain',()=>{
  const g=setup(), out=command(g), p=JSON.parse(out.mqtt.payload);
  assert.equal(out.mqtt.topic,'aerodry/g21/esp32_01/cmd'); assert.equal(out.mqtt.retain,false);
  assert.equal(p.ttl_sec,5); assert.equal(p.connection_id,1); assert.equal(p.boot_id,'boot1');
  assert.equal(out.feedback.payload.status,'PENDING');
  assert.equal(command(g).feedback.payload.reason,'COMMAND_PENDING');
});
test('ACK must match device, boot, connection and cmd; retained ACK ignored',()=>{
  const g=setup(); command(g);
  for (const patch of [{cmd_id:'wrong'},{device_id:'wrong'},{boot_id:'wrong'},{connection_id:2},{status:'made-up'}]) assert.equal(g.ack(ack(g,patch),now+2),null);
  assert.equal(g.ack({...ack(g),retain:true},now+2),null);
  assert.equal(g.ack(ack(g),now+2).payload.status,'ACCEPTED'); assert.equal(g.pending,null);
});
test('timeout and late ACK never become success; no automatic retry on reconnect',()=>{
  const g=setup(); const out=command(g), late=ack(g);
  const messages=g.tick(now+5001); assert.equal(messages[0].payload.status,'TIMEOUT');
  assert.equal(g.ack(late,now+5002),null); heartbeat(g,now+6000);
  assert.equal(routeMessage(g,{topic:'$tick'},now+6000)[0],null); assert.ok(out.mqtt);
});
test('device reboot / broker reconnect invalidates in-flight command',()=>{
  const g=setup(); command(g); heartbeat(g,now+2,{connection_id:2});
  assert.equal(g.tick(now+2)[0].payload.status,'TIMEOUT');
});
test('simulation is per-session, cannot publish a real command or write history',()=>{
  const g=setup(); routeMessage(g,{topic:'simulation_mode',socketid:'A',payload:true},now);
  assert.equal(command(g).feedback.payload.reason,'SIMULATION_ISOLATED');
  const out=routeMessage(g,{topic:'aerodry/g21/sim/esp32_01/telemetry',socketid:'A',payload:{temp:30,hum:60}},now);
  assert.equal(out[0],null); assert.equal(out[3].payload.is_simulation,true); assert.equal(out[3].socketid,'A');
});
test('reset requires explicit confirmation and malformed commands fail',()=>{
  const g=setup(); assert.equal(command(g,{payload:{action:'RESET_COUNTER'}}).feedback.payload.reason,'RESET_CONFIRMATION_REQUIRED');
  for(const payload of [null,[],{action:'SET_FAN',params:{state:true}},{action:'UNKNOWN'},{action:'SET_LIGHT',params:{mode:'MANUAL'}}]) assert.equal(command(g,{payload}).feedback.payload.status,'REJECTED');
  assert.ok(command(g,{payload:{action:'RESET_COUNTER',confirmed:true}}).mqtt);
});
test('legacy UI commands normalize to one canonical protocol',()=>{
  const g=setup();
  for(const payload of [{action:'EXTEND'},{action:'RETRACT'},{mode:'AUTO'},{fan:true},{light:false},{light_mode:'AUTO'}]) assert.ok(g.normalize({payload}).action.startsWith('SET_'));
});
test('all dashboard controls route through gateway; no optimistic feedback or sample seed',()=>{
  const nodes=JSON.parse(fs.readFileSync(require.resolve('../nodered_data/flows.json'),'utf8'));
  const controls=['ui_btn_extend','ui_btn_retract','ui_btn_reset_timer','ui_switch_mode','ui_switch_fan','ui_switch_light','ui_stitch_webapp'];
  for(const id of controls) assert.deepEqual(nodes.find(n=>n.id===id).wires,[['fn_linh_control_gateway']]);
  assert.equal(nodes.some(n=>['fn_local_control_feedback','inject_startup_seed'].includes(n.id)),false);
  for(const n of nodes.filter(n=>n.type==='function')) assert.doesNotThrow(()=>new vm.Script(`(function(msg,node,flow,global,env){${n.func}\n})`));
  const ids=new Set(nodes.map(n=>n.id));
  for(const n of nodes) for(const wire of n.wires || []) for(const id of wire) assert.ok(ids.has(id),`dangling wire ${id}`);
});
