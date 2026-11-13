'use strict';

// Four Node-RED outputs: command MQTT, per-client feedback, connection, simulation.
function routeMessage(gateway, msg, now = Date.now()) {
  const feedback = gateway.tick(now);
  let mqtt = null, simulation = null;
  const socketid = msg.socketid;
  if (msg.topic === 'login_action') {
    feedback.push(gateway.login(msg, now));
  } else if (msg.topic === 'simulation_mode' || msg.topic === 'sim') {
    const session = gateway.sessions.get(socketid);
    if (!session) feedback.push(gateway.result('REJECTED', 'UNAUTHENTICATED', socketid));
    else {
      session.simulation = msg.payload === true;
      feedback.push({ socketid, payload: { kind: 'simulation', enabled: session.simulation } });
    }
  } else if (msg.topic === '$broker') {
    gateway.brokerOnline = msg.status?.text === 'node-red:common.status.connected' || msg.status?.text === 'connected';
    if (!gateway.brokerOnline) gateway.device.online = false;
    feedback.push(...gateway.tick(now));
  } else if (msg.topic === `aerodry/g21/${gateway.deviceId}/heartbeat`) {
    gateway.heartbeat(msg, now);
    feedback.push(...gateway.tick(now));
  } else if (msg.topic === `aerodry/g21/${gateway.deviceId}/ack`) {
    const result = gateway.ack(msg, now);
    if (result) feedback.push(result);
  } else if (msg.topic === `aerodry/g21/sim/${gateway.deviceId}/telemetry`) {
    const session = gateway.sessions.get(socketid);
    if (!session?.simulation) feedback.push(gateway.result('REJECTED', 'SIMULATION_DISABLED', socketid));
    else if (msg.payload && typeof msg.payload === 'object') {
      const p = msg.payload;
      // UI preview only: never feeds real telemetry/history/notifications.
      simulation = { socketid, payload: { is_simulation: true, temperature: Number(p.temp), humidity: Number(p.hum),
        rain_percent: Number(p.rain_pct), weather_type: p.weather_type, rack_state: p.rack_state,
        drying_seconds: Number(p.drying_sec || 0), fan_active: !!p.fan, light_active: !!p.light,
        control_mode: p.mode || 'AUTO', wifi_rssi: null, device_ip: 'Simulation' } };
    }
  } else if (msg.topic !== '$tick') {
    const result = gateway.command(msg, now);
    mqtt = result.mqtt || null;
    feedback.push(result.feedback);
  }
  return [mqtt, feedback.length ? feedback : null, { payload: gateway.connection(now) }, simulation];
}

module.exports = { routeMessage };
