'use strict';
const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAeroDryBackend } = require('../backend_cloud_notify/src/index');

describe('W18, W19, W21 - Cloud Flow Node-RED & Backend Verification', () => {
  const flows = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../nodered_data/flows.json'), 'utf8'));

  it('Flow contains MQTT In node for aerodry/g21/esp32_01/session wired to fn_process_session', () => {
    const sessionMqtt = flows.find(n => n.id === 'mqtt_in_session');
    assert.ok(sessionMqtt, 'mqtt_in_session must exist in flows.json');
    assert.equal(sessionMqtt.topic, 'aerodry/g21/esp32_01/session');
    assert.deepEqual(sessionMqtt.wires, [['fn_process_session']]);

    const sessionFn = flows.find(n => n.id === 'fn_process_session');
    assert.ok(sessionFn, 'fn_process_session must exist');
    assert.ok(sessionFn.func.includes('handleSessionPacket'), 'fn_process_session must call handleSessionPacket');
  });

  it('fn_process_session saves session packet to Firestore drying_sessions and batches', async () => {
    const backend = createAeroDryBackend();
    const sessionFn = flows.find(n => n.id === 'fn_process_session');

    // Context mock
    const flowContext = new Map();
    const mockFlow = {
      get: (k) => flowContext.get(k),
      set: (k, v) => flowContext.set(k, v)
    };
    const mockGlobal = {
      get: (k) => (k === 'aeroDryBackend' ? backend : null)
    };
    const mockNode = { warn: () => {} };

    const runSessionNode = (msg) => {
      const flow = mockFlow;
      const global = mockGlobal;
      const node = mockNode;
      return eval(`(function(msg) { ${sessionFn.func} })(msg)`);
    };

    const sessionPacket = {
      device_id: 'esp32_01',
      group_id: 'G21_24C11',
      batch_id: 'BATCH_TEST_001',
      session_id: 1,
      event_type: 'SESSION_CLOSED',
      start_epoch: 1762930000,
      end_epoch: 1762930600,
      session_duration_sec: 600,
      batch_total_drying_sec: 600,
      formatted_batch_total: '00:10:00',
      reason: 'RAIN',
      reason_vi: 'Thu sào do phát hiện mưa',
      is_simulation: false
    };

    const result = runSessionNode({ payload: sessionPacket });
    assert.ok(result, 'Node must return recorded result');
    assert.equal(result.payload.event, 'SESSION_RECORDED');

    // Wait for async Firestore persistence
    await new Promise(r => setTimeout(r, 100));

    // Verify written to Firestore backend
    const sessions = await backend.historyQueryService._queryDryingSessions('esp32_01', 0, Date.now() + 1000000, 10);
    assert.ok(sessions.length >= 1, 'Firestore drying_sessions must contain the saved session');
    const saved = sessions.find(s => s.batch_id === 'BATCH_TEST_001');
    assert.ok(saved, 'Saved session must match batch_id');
    assert.equal(saved.duration_sec, 600);
    assert.equal(saved.retract_reason, 'RAIN');
  });

  it('fn_emergency_alert saves alert event to Firestore events collection', async () => {
    const backend = createAeroDryBackend();
    const alertFn = flows.find(n => n.id === 'fn_emergency_alert');

    const flowContext = new Map();
    const mockFlow = {
      get: (k) => flowContext.get(k),
      set: (k, v) => flowContext.set(k, v)
    };
    const mockGlobal = {
      get: (k) => (k === 'aeroDryBackend' ? backend : null)
    };
    const mockNode = { warn: () => {} };
    const mockEnv = { get: () => 'TEST_KEY' };

    const runAlertNode = (msg) => {
      const flow = mockFlow;
      const global = mockGlobal;
      const node = mockNode;
      const env = mockEnv;
      return eval(`(function(msg) { ${alertFn.func} })(msg)`);
    };

    const alertPacket = {
      event_id: 'EVT_RAIN_TEST_999',
      device_id: 'esp32_01',
      event_code: 'AUTO_RAIN_RETRACT',
      message_vi: 'Phát hiện mưa rào! Đã thu sào an toàn.',
      formatted_time: '00:30:00',
      is_simulation: false
    };

    const outputs = runAlertNode({ payload: alertPacket });
    assert.equal(outputs.length, 3, 'Must have 3 outputs');

    // Verify stored in Firestore events
    const events = await backend.historyQueryService._queryEvents('esp32_01', 0, Date.now() + 1000000, 10);
    const saved = events.find(e => e.event_id === 'EVT_RAIN_TEST_999');
    assert.ok(saved, 'Firestore events must contain the saved event');
    assert.equal(saved.event_code, 'AUTO_RAIN_RETRACT');
  });

  it('fn_emergency_alert with is_simulation: true NEVER dispatches PushSafer/Email and NEVER saves to Firestore', async () => {
    let pushCalls = 0;
    let emailCalls = 0;
    const backend = createAeroDryBackend({}, {
      transports: {
        pushSender: async () => { pushCalls++; return { ok: true }; },
        emailSender: async () => { emailCalls++; return { ok: true }; }
      }
    });
    const alertFn = flows.find(n => n.id === 'fn_emergency_alert');

    const flowContext = new Map();
    const mockFlow = {
      get: (k) => flowContext.get(k),
      set: (k, v) => flowContext.set(k, v)
    };
    const mockGlobal = {
      get: (k) => (k === 'aeroDryBackend' ? backend : null)
    };
    const mockNode = { warn: () => {} };
    const mockEnv = { get: () => 'TEST_KEY' };

    const runAlertNode = (msg) => {
      const flow = mockFlow;
      const global = mockGlobal;
      const node = mockNode;
      const env = mockEnv;
      return eval(`(function(msg) { ${alertFn.func} })(msg)`);
    };

    const simAlert = {
      event_id: 'EVT_SIM_ONLY_001',
      device_id: 'esp32_01',
      event_code: 'AUTO_RAIN_RETRACT',
      message_vi: 'Mô phỏng mưa',
      is_simulation: true
    };

    const outputs = runAlertNode({ payload: simAlert });
    assert.strictEqual(outputs[0], null, 'Output 0 (PushSafer) must be null for simulation');
    assert.strictEqual(outputs[1], null, 'Output 1 (Email) must be null for simulation');
    assert.ok(outputs[2], 'Output 2 (UI Toast) may show simulation toast');
    assert.ok(outputs[2].topic.includes('MÔ PHỎNG'));

    assert.equal(pushCalls, 0, 'No push calls should be dispatched for simulation');
    assert.equal(emailCalls, 0, 'No email calls should be dispatched for simulation');

    const events = await backend.historyQueryService._queryEvents('esp32_01', 0, Date.now() + 1000000, 10);
    const found = events.find(e => e.event_id === 'EVT_SIM_ONLY_001');
    assert.strictEqual(found, undefined, 'Simulation event must NEVER be saved to Firestore');
  });

  it('fn_emergency_alert deduplicates concurrent messages with the same event_id', async () => {
    let pushCalls = 0;
    let emailCalls = 0;
    const backend = createAeroDryBackend({}, {
      transports: {
        pushSender: async () => { pushCalls++; return { ok: true }; },
        emailSender: async () => { emailCalls++; return { ok: true }; }
      }
    });
    const alertFn = flows.find(n => n.id === 'fn_emergency_alert');

    const flowContext = new Map();
    const mockFlow = {
      get: (k) => flowContext.get(k),
      set: (k, v) => flowContext.set(k, v)
    };
    const mockGlobal = {
      get: (k) => (k === 'aeroDryBackend' ? backend : null)
    };
    const mockNode = { warn: () => {} };
    const mockEnv = { get: () => 'TEST_KEY' };

    const runAlertNode = (msg) => {
      const flow = mockFlow;
      const global = mockGlobal;
      const node = mockNode;
      const env = mockEnv;
      return eval(`(function(msg) { ${alertFn.func} })(msg)`);
    };

    const alert1 = {
      event_id: 'EVT_CONCURRENT_DUP_100',
      device_id: 'esp32_01',
      event_code: 'AUTO_RAIN_RETRACT',
      message_vi: 'Mưa rào lớn',
      is_simulation: false
    };

    const out1 = runAlertNode({ payload: alert1 });
    const out2 = runAlertNode({ payload: alert1 }); // duplicate event_id

    // Wait for async notification dispatch
    await new Promise(r => setTimeout(r, 100));

    assert.ok(out1[0], 'First message must be accepted');
    assert.strictEqual(out2[0], null, 'Second message with same event_id must be suppressed');
    assert.strictEqual(out2[1], null, 'Second message email must be suppressed');
    assert.strictEqual(out2[2], null, 'Second message toast must be suppressed');
    assert.equal(pushCalls, 1, 'Only exactly 1 PushSafer call should be dispatched');
    assert.equal(emailCalls, 1, 'Only exactly 1 Email SMTP call should be dispatched');
  });

  it('fn_w19_query_history_24h queries from Firestore and survives Node-RED restart', async () => {
    const backend = createAeroDryBackend();
    // Seed Firestore with a sample and session
    await backend.firestoreService.handleTelemetry({
      device_id: 'esp32_01',
      temp: 28.5,
      hum: 65,
      rain_pct: 0,
      rack_state: 1,
      drying_sec: 1200,
      is_simulation: false
    }, Date.now() - 60000);

    await backend.firestoreService.handleSessionPacket({
      device_id: 'esp32_01',
      batch_id: 'BATCH_RESTART_TEST',
      session_id: 1,
      event_type: 'SESSION_CLOSED',
      session_duration_sec: 1200,
      reason: 'RAIN',
      is_simulation: false
    }, Date.now() - 30000);

    const histFn = flows.find(n => n.id === 'fn_w19_query_history_24h');

    // Simulate Node-RED restarting: flow context is completely EMPTY!
    const emptyFlowContext = new Map();
    const mockFlow = {
      get: (k) => emptyFlowContext.get(k),
      set: (k, v) => emptyFlowContext.set(k, v)
    };
    const mockGlobal = {
      get: (k) => (k === 'aeroDryBackend' ? backend : null)
    };

    let sentMsg = null;
    const mockNode = {
      send: (m) => { sentMsg = m; },
      done: () => {},
      warn: () => {}
    };

    const reqMsg = {
      req: { query: { device_id: 'esp32_01', hours: '24' } },
      payload: {}
    };

    const runHistNode = () => {
      const flow = mockFlow;
      const global = mockGlobal;
      const node = mockNode;
      const msg = reqMsg;
      eval(`(function(msg) { ${histFn.func} })(msg)`);
    };

    runHistNode();

    // Wait for async completion
    await new Promise(r => setTimeout(r, 100));

    assert.ok(sentMsg, 'Node must send response');
    assert.equal(sentMsg.payload.ok, true);
    assert.equal(sentMsg.payload.source, 'FIRESTORE_DATABASE');
    assert.ok(sentMsg.payload.has_data, 'Must have data even when Node-RED RAM was completely empty');
    assert.ok(sentMsg.payload.chart_24h.points.length >= 1, 'Must include sensor sample points from Firestore');
    assert.ok(sentMsg.payload.session_logs.length >= 1, 'Must include session logs from Firestore');
  });
});
