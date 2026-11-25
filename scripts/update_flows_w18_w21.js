'use strict';
const fs = require('fs');
const path = require('path');

const flowsPath = path.resolve(__dirname, '../nodered_data/flows.json');
const flows = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));

// 1. Update fn_emergency_alert
const fnAlert = flows.find(n => n.id === 'fn_emergency_alert');
if (fnAlert) {
  fnAlert.wires = [
    ['debug_pushsafer'],
    ['debug_smtp_email'],
    ['ui_toast_emergency']
  ];
  fnAlert.func = `// Nhận payload từ node MQTT In (topic: aerodry/g21/esp32_01/event)
let alert;
try {
    alert = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;
} catch (e) {
    return [null, null, null];
}
if (!alert || typeof alert !== "object") return [null, null, null];

const nowMs = Date.now();
const isSim = Boolean(alert.is_simulation);
const deviceId = alert.device_id || "esp32_01";
const eventCode = alert.event_code || alert.type || "AUTO_RAIN_RETRACT";
const eventId = alert.event_id || ("EVT_" + deviceId + "_" + nowMs);
const extendAt = flow.get("extend_timestamp") || "08:15:00";
const retractAt = new Date(nowMs).toLocaleTimeString("vi-VN");
const msgText = alert.message_vi || alert.message || "Phát hiện mưa! Đã tự động thu sào.";
const dryStr = alert.formatted_time || alert.drying_time_str || "00:25:00";

// [Mục 3.9 & W21] NẾU LÀ DỮ LIỆU MÔ PHỎNG (SIMULATION MODE):
// Tuyệt đối KHÔNG gửi PushSafer, KHÔNG gửi Email SMTP, KHÔNG ghi vào Firestore thật!
if (isSim) {
    const simToast = {
        topic: "🧪 [MÔ PHỎNG] CẢNH BÁO MƯA (SIMULATION)",
        payload: "[Sim] " + msgText + " | Thời gian: " + dryStr + " (Không gửi PushSafer/Email thật)"
    };
    return [null, null, simToast];
}

// [W21 - F21] CHỐNG GỬI TRÙNG CÙNG MÃ SỰ KIỆN (EVENT_ID DEDUPLICATION)
let processedIds = flow.get("processed_event_ids");
if (!processedIds || !(processedIds instanceof Set)) {
    processedIds = new Set();
    flow.set("processed_event_ids", processedIds);
}
if (processedIds.has(eventId)) {
    node.warn("[W21-DEDUP] Đã chặn gửi trùng cùng event_id: " + eventId);
    return [null, null, null];
}
processedIds.add(eventId);
if (processedIds.size > 300) {
    const oldestKey = processedIds.values().next().value;
    processedIds.delete(oldestKey);
}

// [W21 - F22] CHỐNG GỬI LẶP THEO KHOẢNG THỜI GIAN CHỜ (COOLDOWN - 15 PHÚT GIỮA CÁC CẢNH BÁO CÙNG LOẠI)
const cooldownKey = "alert_cooldown_" + eventCode;
const lastSentMs = flow.get(cooldownKey) || 0;
const cooldownMs = 15 * 60 * 1000;
if (lastSentMs > 0 && (nowMs - lastSentMs < cooldownMs)) {
    const remainSec = Math.round((cooldownMs - (nowMs - lastSentMs)) / 1000);
    node.warn("[W21-COOLDOWN] Đã chặn gửi trùng theo cooldown cho " + eventCode + " (còn " + remainSec + "s)");
    return [null, null, null];
}
flow.set(cooldownKey, nowMs);

// [W18] GHI SỰ KIỆN VÀO FIRESTORE & RAM (Lịch sử 24h)
const events = flow.get("firestore_events") || [];
events.unshift({
    event_id: eventId,
    event_code: eventCode,
    message: msgText,
    drying_time_str: dryStr,
    timestamp_ms: nowMs
});
flow.set("firestore_events", events.slice(0, 100));

const backend = global.get("aeroDryBackend");
let notificationHandledByBackend = false;

if (backend) {
    // 1. Ghi nhận sự kiện vào Firestore collection events
    if (backend.firestoreService) {
        try {
            backend.firestoreService.handleAlertEvent(alert, null, nowMs);
        } catch (err) {
            node.warn("[W18-FIRESTORE] Lỗi ghi event vào Firestore: " + err.message);
        }
    }
    // 2. Gửi cảnh báo tập trung qua Backend NotificationService (W21: có retry, có định tuyến email thiết bị)
    if (backend.notificationService) {
        try {
            backend.notificationService.processAlertEvent(alert, nowMs);
            notificationHandledByBackend = true;
        } catch (err) {
            node.warn("[W21-NOTIFY] Lỗi gửi qua notificationService: " + err.message);
        }
    }
}

// [W21] TRÁNH GỬI TRÙNG 2 ĐƯỜNG PUSHSAFER:
// Nếu Backend NotificationService đã gửi PushSafer/Email thì nhánh 1 và nhánh 2 chỉ gửi bản tin debug/log
let pushMsg = {
    payload: {
        status: notificationHandledByBackend ? "DISPATCHED_VIA_BACKEND_SERVICE" : "STANDALONE_READY",
        event_id: eventId,
        event_code: eventCode,
        device_id: deviceId,
        text: msgText
    }
};

let emailMsg = {
    topic: "[AeroDry IoT - G21_24C11] [Thiết bị: " + deviceId + "] Đã tự động thu sào (Thời gian đã phơi: " + dryStr + ")",
    payload: "Hệ thống giàn phơi thông minh AeroDry IoT phát hiện sự kiện: " + msgText + "\\nThời gian đã phơi: " + dryStr
};

// Nhánh 3: Hiển thị thông báo khẩn cấp ngay trên Web Dashboard
const toastMsg = {
    topic: "⛈️ CẢNH BÁO MƯA KHẨN CẤP - ĐÃ THU SÀO (0°)",
    payload: msgText + " Tổng thời gian đã phơi: " + dryStr + ". Bạn có muốn bật Quạt sấy đối lưu?"
};

return [pushMsg, emailMsg, toastMsg];`;
}

// 2. Update fn_w19_query_history_24h
const fnHist = flows.find(n => n.id === 'fn_w19_query_history_24h');
if (fnHist) {
  fnHist.func = `const nowMs = Date.now();
const deviceId = msg.req?.query?.device_id || "esp32_01";
const hours = Number(msg.req?.query?.hours || 24);

const backend = global.get("aeroDryBackend");

if (backend && typeof backend.getHistory24h === "function") {
    backend.getHistory24h({ deviceId, hours, nowMs })
        .then(data => {
            const samples = (data.chart_24h && data.chart_24h.points) ? data.chart_24h.points : [];
            const sessions = data.session_logs || [];
            const events = data.event_logs || [];

            msg.payload = {
                ok: true,
                device_id: deviceId,
                has_data: data.has_data !== undefined ? data.has_data : (samples.length > 0 || sessions.length > 0 || events.length > 0),
                chart_24h: {
                    sample_count: (data.summary && data.summary.sample_count) || samples.length,
                    points: samples,
                    detected_gaps: (data.chart_24h && data.chart_24h.detected_gaps) || []
                },
                session_logs: sessions,
                event_logs: events,
                summary: data.summary || null,
                server_time_iso: data.server_time_iso || new Date(nowMs).toISOString(),
                source: "FIRESTORE_DATABASE"
            };
            node.send(msg);
            node.done();
        })
        .catch(err => {
            node.warn("[W19-HISTORY] Lỗi truy vấn Firestore: " + err.message + ", fallback về RAM cache");
            const sinceMs = nowMs - hours * 3600 * 1000;
            const samples = (flow.get("firestore_sensor_samples") || []).filter(s => s.timestamp_ms >= sinceMs);
            const sessions = (flow.get("firestore_drying_sessions") || []).filter(s => s.timestamp_ms >= sinceMs);
            const events = (flow.get("firestore_events") || []).filter(e => e.timestamp_ms >= sinceMs);
            msg.payload = {
                ok: true,
                device_id: deviceId,
                has_data: samples.length > 0 || sessions.length > 0 || events.length > 0,
                chart_24h: { sample_count: samples.length, points: samples },
                session_logs: sessions,
                event_logs: events,
                server_time_iso: new Date(nowMs).toISOString(),
                source: "MEMORY_CACHE_FALLBACK",
                warning: err.message
            };
            node.send(msg);
            node.done();
        });
    return;
}

const sinceMs = nowMs - hours * 3600 * 1000;
const samples = (flow.get("firestore_sensor_samples") || []).filter(s => s.timestamp_ms >= sinceMs);
const sessions = (flow.get("firestore_drying_sessions") || []).filter(s => s.timestamp_ms >= sinceMs);
const events = (flow.get("firestore_events") || []).filter(e => e.timestamp_ms >= sinceMs);

msg.payload = {
    ok: true,
    device_id: deviceId,
    has_data: samples.length > 0 || sessions.length > 0 || events.length > 0,
    chart_24h: { sample_count: samples.length, points: samples },
    session_logs: sessions,
    event_logs: events,
    server_time_iso: new Date(nowMs).toISOString(),
    source: "MEMORY_LOCAL"
};
return msg;`;
}

// 3. Update fn_process_telemetry to also handle session fallback in Firestore
const fnTelem = flows.find(n => n.id === 'fn_process_telemetry');
if (fnTelem && !fnTelem.func.includes('backend.firestoreService.handleSessionPacket')) {
  fnTelem.func = fnTelem.func.replace(
    'flow.set("firestore_drying_sessions", sessions.slice(0, 100));',
    `flow.set("firestore_drying_sessions", sessions.slice(0, 100));
        try {
            const backend = global.get("aeroDryBackend");
            if (backend && backend.firestoreService) {
                backend.firestoreService.handleSessionPacket({
                    group_id: "G21_24C11",
                    device_id: data.device_id || "esp32_01",
                    batch_id: batchId,
                    session_id: sessions.length,
                    event_type: "SESSION_CLOSED",
                    session_duration_sec: durSec,
                    batch_total_drying_sec: Number(data.drying_sec || durSec),
                    formatted_batch_total: data.drying_time_str || "00:00:00",
                    reason: reason,
                    time_synced: false,
                    is_simulation: false
                }, nowMs);
            }
        } catch (_) {}`
  );
}

// 4. Update fn_trigger_sim_alert to include is_simulation: true
const fnSimAlert = flows.find(n => n.id === 'fn_trigger_sim_alert');
if (fnSimAlert) {
  fnSimAlert.func = `msg.payload = {
    type: "RAIN_DETECTED",
    event_code: "AUTO_RAIN_RETRACT",
    message: "Mưa rào lớn bất chợt! Đã tự động xoay Servo thu sào về góc 0 độ.",
    drying_time_str: "00:25:00",
    drying_minutes: 25,
    is_simulation: true
};
return msg;`;
}

// 5. Remove http_pushsafer_req node if present
const filteredFlows = flows.filter(n => n.id !== 'http_pushsafer_req');

// 6. Add mqtt_in_session, fn_process_session, debug_session_record if not present
if (!filteredFlows.some(n => n.id === 'mqtt_in_session')) {
  filteredFlows.push({
    id: "mqtt_in_session",
    type: "mqtt in",
    z: "tab_aerodry_flow",
    name: "MQTT In: Phiên phơi ESP32 (smartdry/drying/session)",
    topic: "aerodry/g21/esp32_01/session",
    qos: "0",
    datatype: "auto-detect",
    broker: "mqtt_broker_hivemq",
    nl: false,
    rap: true,
    rh: 0,
    inputs: 0,
    x: 180,
    y: 1680,
    wires: [ [ "fn_process_session" ] ]
  });

  filteredFlows.push({
    id: "fn_process_session",
    type: "function",
    z: "tab_aerodry_flow",
    name: "Function Node: Ghi nhận Phiên phơi (W18 /session)",
    func: `// Nhận payload từ node MQTT In (topic: aerodry/g21/esp32_01/session)
let data;
try {
    data = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;
} catch (e) {
    return null;
}

if (!data || data.device_id !== "esp32_01") return null;

const nowMs = Date.now();
const isSim = Boolean(data.is_simulation);

// [W18] Cập nhật phiên vào Flow context để phục vụ hiển thị Live UI ngay lập tức
if (!isSim) {
    const sessions = flow.get("firestore_drying_sessions") || [];
    const durSec = Number(data.session_duration_sec || 0);
    const startEpoch = Number(data.start_epoch || 0);
    const endEpoch = Number(data.end_epoch || 0);
    const startMs = startEpoch > 1700000000 ? startEpoch * 1000 : (nowMs - durSec * 1000);
    const endMs = endEpoch > 1700000000 ? endEpoch * 1000 : nowMs;

    sessions.unshift({
        doc_id: (data.batch_id || "BATCH_001") + "_S" + String(data.session_id || sessions.length + 1).padStart(3, "0"),
        batch_id: data.batch_id || flow.get("current_batch_id") || "BATCH_001",
        session_id: Number(data.session_id || sessions.length + 1),
        start_time: new Date(startMs).toLocaleTimeString("vi-VN"),
        end_time: new Date(endMs).toLocaleTimeString("vi-VN"),
        start_time_iso: new Date(startMs).toISOString(),
        end_time_iso: new Date(endMs).toISOString(),
        start_time_ms: startMs,
        end_time_ms: endMs,
        duration_sec: durSec,
        duration_min: Math.round(durSec / 60),
        retract_reason: data.reason || "MANUAL_OR_AUTO",
        retract_reason_vi: data.reason_vi || "",
        interrupted: Boolean(data.interrupted),
        timestamp_ms: nowMs
    });
    flow.set("firestore_drying_sessions", sessions.slice(0, 100));

    // [W18] Ghi nhận trực tiếp vào Firestore collection drying_sessions & batches
    try {
        const backend = global.get("aeroDryBackend");
        if (backend && backend.firestoreService) {
            backend.firestoreService.handleSessionPacket(data, nowMs);
        }
    } catch (err) {
        node.warn("[W18-SESSION] Lỗi ghi Firestore session: " + err.message);
    }
}

msg.payload = {
    event: "SESSION_RECORDED",
    session_id: data.session_id,
    batch_id: data.batch_id,
    is_simulation: isSim
};
return msg;`,
    outputs: 1,
    timeout: "",
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 540,
    y: 1680,
    wires: [ [ "debug_session_record" ] ]
  });

  filteredFlows.push({
    id: "debug_session_record",
    type: "debug",
    z: "tab_aerodry_flow",
    name: "Bản tin Phiên phơi Firestore (W18)",
    active: true,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: "payload",
    targetType: "msg",
    statusVal: "",
    statusType: "auto",
    x: 880,
    y: 1680,
    wires: []
  });
}

fs.writeFileSync(flowsPath, JSON.stringify(filteredFlows, null, 2), 'utf8');
console.log('Successfully updated flows.json! Total nodes:', filteredFlows.length);
