'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'nodered_data/flows.json');
let nodes = JSON.parse(fs.readFileSync(target, 'utf8'));
const find = id => nodes.find(n => n.id === id);
const tab = 'tab_aerodry_flow';
const gatewayId = 'fn_linh_control_gateway';
// Remove the optimistic feedback, old bypass router, sample injection, and mock login.
const removed = new Set(['fn_local_control_feedback','fn_stitch_downlink_router','inject_startup_seed','fn_seed_dashboard',
  'fn_store_credentials','ui_input_email','ui_input_password','ui_btn_login','ui_text_auth_status',
  'ui_text_login_banner','ui_control_redirect','ui_tab_login','ui_group_login']);
nodes = nodes.filter(n => !removed.has(n.id));
for (const n of nodes) if (n.wires) n.wires = n.wires.map(w => w.filter(id => !removed.has(id)));
function upsert(node) {
  nodes = nodes.filter(n => n.id !== node.id);
  nodes.push({ z: tab, ...node });
}
for (const id of ['ui_btn_extend','ui_btn_retract','ui_btn_reset_timer','ui_switch_mode','ui_switch_fan','ui_switch_light','ui_switch_sim',
  'ui_btn_sim_sunny','ui_btn_sim_shower','ui_btn_sim_heavy_rain']) {
  const n = find(id); n.wires = [[gatewayId]];
  if (n.topic?.startsWith('smartdry/sensor/')) n.topic = 'aerodry/g21/sim/esp32_01/telemetry';
  if (n.id === 'ui_btn_reset_timer') { n.payload = JSON.stringify({action:'RESET_COUNTER',confirmed:false}); n.tooltip = 'Dùng nút Reset trong giao diện chính để xác nhận mẻ mới'; }
}
find('mqtt_in_telemetry').topic = 'aerodry/g21/esp32_01/telemetry';
find('mqtt_in_alert').topic = 'aerodry/g21/esp32_01/event';
find('mqtt_out_rack').topic = 'aerodry/g21/esp32_01/cmd';
find('mqtt_out_rack').name = 'W17: MQTT command (QoS 0, no retain)';
find('mqtt_out_rack').retain = 'false'; find('mqtt_out_rack').qos = '0';
nodes = nodes.filter(n => n.id !== 'mqtt_out_dryer');
const broker = find('mqtt_broker_hivemq');
broker.name = 'AeroDry broker (configure credentials in editor)';
broker.broker = '${AERODRY_MQTT_HOST}'; broker.port = '${AERODRY_MQTT_PORT}';
broker.keepalive = '15';
const telemetry = find('fn_process_telemetry');
if (!telemetry.func.includes('IGNORE_SIMULATION_AT_REAL_INPUT')) {
  telemetry.func = telemetry.func.replace('const data = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;',
    'let data; try { data = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload; } catch { return null; }\n// IGNORE_SIMULATION_AT_REAL_INPUT\nif (!data || data.device_id !== "esp32_01" || data.is_simulation === true) return null;');
  telemetry.func = telemetry.func.replace('online_status: isSim ? "🧪 SIMULATION MODE (Cách ly dữ liệu thật)" : "🟢 ONLINE (MQTT Connected)",',
    'online_status: "Xem trạng thái heartbeat",\n    light_mode: data.light_mode || data.actuators?.light_mode || "AUTO",\n    demo_fast_dry: !!data.drying?.demo_fast_dry,');
  telemetry.func = telemetry.func.replace('{ payload: formattedPayload.online_status },', 'null,');
  telemetry.func = telemetry.func.replace('let extendTimeStr = flow.get("extend_timestamp") || "08:15:00";', 'let extendTimeStr = flow.get("extend_timestamp") || "—";')
    .replace('let retractTimeStr = flow.get("retract_timestamp") || "14:20:35";', 'let retractTimeStr = flow.get("retract_timestamp") || "—";');
  telemetry.func = telemetry.func.replace('data.temp ?? 31.5','data.temp ?? null').replace('data.hum ?? 64','data.hum ?? null')
    .replace('data.rain_pct ?? 5','data.rain_pct ?? 0').replace('data.drying_sec ?? 5420','data.drying_sec ?? 0')
    .replace('data.drying_min ?? 90','data.drying_min ?? 0').replace('data.drying_time_str || "01:30:20"','data.drying_time_str || "00:00:00"')
    .replace('data.rack_state ?? 1','data.rack_state ?? 0').replace('data.rssi ?? -58','data.rssi ?? null')
    .replace('data.ip || "192.168.1.108"','data.ip || "—"');
}
const ui = find('ui_stitch_webapp');
ui.wires = [[gatewayId]]; ui.resendOnRefresh = false;
let html = ui.format.replace(/<script>[\s\S]*?<\/script>\s*$/, '');
if (!html.includes('id="ad-command-status"')) {
  html = html.replace('<span class="ad-badge ad-badge-ok">Đang kết nối</span>', '<span id="ad-connection" class="ad-badge ad-badge-info">OFFLINE</span>')
    .replace('<span class="ad-badge ad-badge-ok">Ổn định</span>', '<span id="ad-last-seen" class="ad-badge">Chưa nhận heartbeat</span>')
    .replace('>Rất tốt</span>', '>RSSI từ thiết bị</span>');
  html = html.replace(/onclick="window\.(adControlRack\([^\"]*\)|adToggleFan\(\)|adToggleLight\(\)|adToggleAutoMode\(\))"/g, '$& data-device-control');
  html = html.replace('<!-- Concise Status Hint -->', `<div id="ad-command-status" role="status" aria-live="polite">Chưa gửi lệnh</div>
    <button type="button" class="ad-btn-secondary" data-device-control onclick="window.adSetLightAuto()">Đèn: chuyển về Auto</button>
    <button type="button" class="ad-btn-secondary" data-device-control onclick="window.adToggleFastDry()"><span id="ad-fast-dry-label">Chuẩn: chờ khô 180 giây</span></button>
    <!-- Concise Status Hint -->`);
  // SVG charts in the design are placeholders, not historical device data.
  html = html.replace(/(<svg viewBox="0 0 500[\s\S]*?<\/svg>)/g, '<p>Lịch sử: chờ kết nối dữ liệu W19 từ backend.</p>');
}
ui.format = html + '<script>\n' + fs.readFileSync(path.join(root,'nodered_data/ui/control.js'),'utf8') + '\n</script>\n';
upsert({ id: gatewayId, type:'function', name:'Linh W17: command / matchAck / heartbeat', outputs:4,
  func:'return global.get("aeroDryRoute")(global.get("aeroDryControl"), msg);',
  initialize:'global.get("aeroDryControl").reset();', finalize:'global.get("aeroDryControl").reset();',
  x:510,y:700,wires:[['mqtt_out_rack'],['ui_stitch_webapp','ui_command_result'],['ui_stitch_webapp','fn_linh_connection_ui'],['ui_stitch_webapp']] });
for (const [suffix,topic] of [['heartbeat','heartbeat'],['ack','ack']]) upsert({ id:'mqtt_linh_'+suffix,type:'mqtt in',
  name:'W17 '+suffix,topic:`aerodry/g21/esp32_01/${topic}`,qos:'0',datatype:'json',broker:broker.id,
  nl:false,rap:true,rh:0,inputs:0,x:180,y:suffix==='ack'?900:950,wires:[[gatewayId]] });
upsert({ id:'linh_tick',type:'inject',name:'W17: timeout / offline (1s)',props:[{p:'topic',vt:'str'}],topic:'$tick',
  repeat:'1',once:true,onceDelay:'0.2',x:180,y:1000,wires:[[gatewayId]] });
upsert({ id:'linh_broker_status',type:'status',name:'W17: broker connection',scope:['mqtt_linh_heartbeat'],x:180,y:1050,wires:[['fn_linh_broker_status']] });
upsert({ id:'fn_linh_broker_status',type:'function',name:'Broker event',outputs:1,func:'msg.topic="$broker"; return msg;',x:380,y:1050,wires:[[gatewayId]] });
upsert({ id:'fn_linh_connection_ui',type:'function',name:'Connection status for dashboard',outputs:1,
  func:'msg.payload=msg.payload.online ? "ONLINE" : "OFFLINE / dữ liệu cũ"; return msg;',x:760,y:1000,wires:[['ui_text_online']] });
upsert({ id:'ui_command_result',type:'ui_text',group:'ui_group_col3_actuator',order:8,width:6,height:1,label:'Phản hồi thiết bị',
  format:'{{msg.payload.status}} {{msg.payload.reason}}',layout:'row-spread',x:970,y:700,wires:[] });
fs.writeFileSync(target,JSON.stringify(nodes,null,4)+'\n');
console.log(`Updated ${nodes.length} nodes in nodered_data/flows.json`);
