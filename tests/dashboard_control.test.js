'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function ui() {
  const elements=new Map(), sent=[], controls=[];
  const element=()=>({textContent:'',value:'',style:{},classList:{toggle(){},contains(){return false;}},
    setAttribute(){},querySelectorAll(){return controls;},remove(){},parentElement:null});
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const body=element(),root=get('aerodry-stitch-app');root.parentElement=body;
  controls.push(element());
  let receive;
  const scope={send:m=>sent.push(m),$watch:(key,callback)=>{receive=callback;},$on(){}};
  const context={scope,document:{body,getElementById:get},window:{confirm:()=>false},
    localStorage:{getItem(){return null;},setItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},Date};
  vm.runInNewContext(fs.readFileSync('nodered_data/ui/control.js','utf8'),context);
  return {context,get,sent,controls,receive:p=>receive({payload:p})};
}
test('UI waits for server authentication and device ACK; clicking never invents actuator success',()=>{
  const u=ui();
  u.get('ad-login-email').value='linh';u.get('ad-login-password').value='secret';
  u.context.window.adHandleLogin({preventDefault(){}});
  assert.equal(u.sent[0].payload.password,'secret'); assert.notEqual(u.get('view-dashboard').style.display,'block');
  u.receive({kind:'auth',ok:true});
  u.receive({kind:'connection',online:true,last_seen_ms:Date.now()});
  assert.equal(u.controls[0].disabled,false);
  u.context.window.adControlRack('RETRACT');
  assert.equal(u.sent.at(-1).payload.action,'SET_ROD');assert.equal(u.controls[0].disabled,true);
  assert.equal(u.get('ad-rack-badge').textContent,'Chưa có trạng thái');
  u.receive({kind:'command_result',status:'TIMEOUT',reason:'ACK_TIMEOUT'});
  assert.equal(u.get('ad-rack-badge').textContent,'Chưa có trạng thái');
  u.receive({kind:'command_result',status:'ACCEPTED',reason:'OK',resulting_state:{rod_state:'RETRACTED',fan_state:'OFF',light_state:'OFF',control_mode:'MANUAL',light_mode:'AUTO',total_drying_sec:10}});
  assert.equal(u.get('ad-rack-badge').textContent,'Yêu cầu thu (0°)');
  u.receive({kind:'connection',online:false}); assert.equal(u.controls[0].disabled,true);
});
test('reset cancellation sends nothing and simulation cannot emit a device command',()=>{
  const u=ui(); u.receive({kind:'auth',ok:true});u.receive({kind:'connection',online:true});
  u.context.window.adControlRack('RESET_TIMER'); assert.equal(u.sent.length,0);
  u.receive({kind:'simulation',enabled:true});u.context.window.adToggleFan(); assert.equal(u.sent.length,0);
  u.context.window.adSimulateWeather('SHOWER'); assert.equal(u.sent.at(-1).topic,'aerodry/g21/sim/esp32_01/telemetry');
});
