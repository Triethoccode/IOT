/**
 * W18 – MODULE LƯU TRỮ CLOUD FIRESTORE (Mẫu cảm biến 60s, Mẻ đồ, Phiên phơi & Sự kiện)
 * Phụ trách: Tạ Bỉnh Phong (24127100) – Nhận từ Triết
 */
const fs = require('fs');
const path = require('path');
const defaultConfig = require('./config');

class FirestoreService {
  constructor(customConfig = {}, customDb = null) {
    this.config = {
      ...defaultConfig,
      ...customConfig,
      firestore: { ...defaultConfig.firestore, ...(customConfig.firestore || {}) },
    };
    this.db = customDb;
    this.lastSampleSavedAtByDevice = new Map();

    // Bộ nhớ dự phòng cục bộ (dùng khi kiểm thử W06 hoặc khi chưa nạp file serviceAccountKey.json)
    this.memoryStore = {
      users: new Map(),
      devices: new Map(),
      sensor_samples: [],
      batches: new Map(),
      drying_sessions: [],
      events: [],
    };
  }

  /**
   * Khởi tạo kết nối Firebase Admin SDK (nếu có file khóa dịch vụ)
   */
  initFirebase() {
    if (this.db) return true;
    try {
      const admin = require('firebase-admin');
      const candidatePaths = [
        this.config.firestore.serviceAccountPath,
        this.config.firestore.serviceAccountPath ? path.resolve(this.config.firestore.serviceAccountPath) : null,
        path.resolve(__dirname, '../serviceAccountKey.json'),
        path.resolve(__dirname, '../../serviceAccountKey.json'),
        path.resolve(__dirname, '../../nodered_data/firebase_key.json'),
        path.resolve('serviceAccountKey.json'),
        path.resolve('backend_cloud_notify/serviceAccountKey.json'),
      ];
      const resolvedKeyPath = candidatePaths.find(p => p && fs.existsSync(p));
      if (resolvedKeyPath) {
        const serviceAccount = JSON.parse(fs.readFileSync(resolvedKeyPath, 'utf8'));
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: this.config.firestore.projectId || serviceAccount.project_id,
          });
        }
        this.db = admin.firestore();
        return true;
      }
    } catch (err) {
      // Chuyển sang chế độ lưu trữ bộ nhớ cục bộ nếu chưa cấu hình khóa Firebase
    }
    return false;
  }

  /**
   * Chuyển đổi timestamp từ ESP32:
   * Nếu ESP32 đã đồng bộ NTP (time_synced = true, timestamp > 1700000000), dùng mốc đó;
   * nếu chưa đồng bộ NTP, dùng giờ máy chủ nhận bản tin và gắn cờ time_synced = false.
   */
  resolveTimestampMs(payload, nowMs = Date.now()) {
    const rawTs = Number(payload.timestamp || payload.end_epoch || payload.start_epoch || 0);
    if (payload.time_synced && rawTs > 1700000000) {
      return rawTs * 1000;
    }
    if (rawTs > 1700000000000) {
      return rawTs;
    }
    return nowMs;
  }

  /**
   * [W18 - F19] Xử lý bản tin Telemetry mỗi 2.5s từ ESP32:
   * - Luôn cập nhật trạng thái mới nhất vào `devices/{deviceId}`
   * - Chỉ ghi vào `sensor_samples` mỗi 60 giây (60000 ms) để kiểm soát lượng ghi Firestore
   * - Tuyệt đối bỏ qua bản tin Simulation Mode (`is_simulation == true`)
   */
  async handleTelemetry(payload, nowMs = Date.now()) {
    if (!payload || typeof payload !== 'object') {
      return { savedSample: false, reason: 'INVALID_PAYLOAD' };
    }
    // Mục 3.9: Không đưa số liệu giả lập từ Simulation Mode vào lịch sử thật
    if (payload.is_simulation === true) {
      return { savedSample: false, reason: 'SIMULATION_MODE_IGNORED' };
    }

    const deviceId = payload.device_id || this.config.deviceId;
    const timestampMs = this.resolveTimestampMs(payload, nowMs);
    const sensors = payload.sensors || {};
    const actuators = payload.actuators || {};
    const drying = payload.drying || {};

    const dhtValid =
      sensors.dht_valid !== undefined
        ? Boolean(sensors.dht_valid)
        : payload.dht_valid !== undefined
        ? Boolean(payload.dht_valid)
        : payload.temp !== null && payload.temp !== undefined && !Number.isNaN(Number(payload.temp));

    const tempVal = dhtValid
      ? Number(sensors.temperature_c ?? payload.temp ?? 0)
      : null;
    const humVal = dhtValid
      ? Number(sensors.humidity_pct ?? payload.hum ?? 0)
      : null;
    const wetPct = Number(sensors.wet_percent ?? payload.rain_pct ?? 0);
    const wetLabel =
      sensors.wet_label ||
      (wetPct >= 50 ? 'HEAVY_WET' : wetPct >= 30 ? 'WET' : wetPct >= 15 ? 'TRANSITION' : 'DRY');
    const wetTextVi =
      sensors.wet_text_vi ||
      (wetPct >= 50 ? 'Ướt nhiều' : wetPct >= 15 ? 'Đang ướt' : 'Khô');
    const rodState =
      actuators.rod_state ||
      (payload.rack_state === 1 ? 'EXTENDED' : 'RETRACTED');
    const controlMode = actuators.control_mode || payload.mode || 'AUTO';
    const totalDryingSec = Number(drying.total_drying_sec ?? payload.drying_sec ?? 0);

    // 1. Cập nhật snapshot thiết bị hiện hành
    const deviceDoc = {
      group_id: payload.group_id || this.config.groupId,
      device_id: deviceId,
      last_seen_ms: nowMs,
      device_timestamp_ms: timestampMs,
      time_synced: Boolean(payload.time_synced),
      uptime_sec: Number(payload.uptime_sec || 0),
      wifi: payload.wifi || { rssi: payload.rssi ?? -56, ip: payload.ip || '192.168.1.108' },
      sensors: {
        dht_valid: dhtValid,
        temperature_c: tempVal,
        humidity_pct: humVal,
        rain_adc: Number(sensors.rain_adc ?? 0),
        wet_percent: wetPct,
        wet_label: wetLabel,
        wet_text_vi: wetTextVi,
        ldr_adc: Number(sensors.ldr_adc ?? payload.ldr_raw ?? 0),
        light_percent: Number(sensors.light_percent ?? 0),
        is_dark: Boolean(sensors.is_dark),
      },
      actuators: {
        control_mode: controlMode,
        rod_state: rodState,
        fan_state: actuators.fan_state || (payload.fan ? 'ON' : 'OFF'),
        light_mode: actuators.light_mode || payload.light_mode || 'AUTO',
        light_state: actuators.light_state || (payload.light ? 'ON' : 'OFF'),
      },
      drying,
    };

    await this._saveDoc(this.config.firestore.collections.devices, deviceId, deviceDoc, true);

    // 2. Kiểm tra chu kỳ 60 giây trước khi ghi mẫu vào `sensor_samples` (Mục 3.7)
    const lastSavedMs = this.lastSampleSavedAtByDevice.get(deviceId) || 0;
    const intervalMs = this.config.firestore.sampleSaveIntervalMs;

    if (lastSavedMs > 0 && nowMs - lastSavedMs < intervalMs) {
      return {
        savedSample: false,
        reason: 'THROTTLED_60S_INTERVAL',
        nextSaveInMs: intervalMs - (nowMs - lastSavedMs),
      };
    }

    this.lastSampleSavedAtByDevice.set(deviceId, nowMs);

    const sampleId = `SMP_${deviceId}_${timestampMs}`;
    const sampleDoc = {
      sample_id: sampleId,
      group_id: payload.group_id || this.config.groupId,
      device_id: deviceId,
      is_simulation: false,
      timestamp_ms: timestampMs,
      recorded_at_iso: new Date(timestampMs).toISOString(),
      time_synced: Boolean(payload.time_synced),
      // Mục 3.1 & 3.10: Khi DHT11 đọc lỗi, đánh dấu dht_valid = false và giữ null, không lưu giá trị giả
      dht_valid: dhtValid,
      temperature_c: tempVal,
      humidity_pct: humVal,
      wet_percent: wetPct,
      wet_label: wetLabel,
      wet_text_vi: wetTextVi,
      light_percent: Number(sensors.light_percent ?? 0),
      is_dark: Boolean(sensors.is_dark),
      rod_state: rodState,
      control_mode: controlMode,
      batch_id: drying.batch_id || payload.batch_id || null,
      total_drying_sec: totalDryingSec,
    };

    await this._saveDoc(this.config.firestore.collections.sensorSamples, sampleId, sampleDoc, false);
    return { savedSample: true, sampleId, sampleDoc };
  }

  /**
   * [W18 - F09, F10, F19] Lưu thông tin Mẻ đồ (`batches`) và Phiên phơi (`drying_sessions`)
   * Mỗi phiên có: mã mẻ, mốc bắt đầu, mốc kết thúc, thời lượng và nguyên nhân thu.
   * Khi Reset mẻ mới, lịch sử mẻ cũ trên Cloud vẫn được giữ nguyên (Mục 3.4).
   */
  async handleSessionPacket(payload, nowMs = Date.now()) {
    if (!payload || typeof payload !== 'object') {
      return { saved: false, reason: 'INVALID_PAYLOAD' };
    }
    if (payload.is_simulation === true) {
      return { saved: false, reason: 'SIMULATION_MODE_IGNORED' };
    }

    const deviceId = payload.device_id || this.config.deviceId;
    const batchId = payload.batch_id || 'BATCH_UNKNOWN';
    const sessionIdNum = Number(payload.session_id || 0);
    const eventType = payload.event_type || 'SESSION_CLOSED';

    const startEpochSec = Number(payload.start_epoch || 0);
    const endEpochSec = Number(payload.end_epoch || 0);
    const startMs = startEpochSec > 1700000000 ? startEpochSec * 1000 : nowMs - Number(payload.session_duration_sec || 0) * 1000;
    const endMs = endEpochSec > 1700000000 ? endEpochSec * 1000 : nowMs;

    // 1. Cập nhật thông tin Mẻ đồ (`batches/{batchId}`)
    const existingBatch = await this._getBatch(batchId);
    const batchDoc = {
      batch_id: batchId,
      group_id: payload.group_id || this.config.groupId,
      device_id: deviceId,
      is_simulation: false,
      started_at_ms: existingBatch ? existingBatch.started_at_ms : startMs,
      updated_at_ms: nowMs,
      ended_at_ms: eventType === 'BATCH_RESET' ? endMs : (existingBatch ? existingBatch.ended_at_ms : null),
      total_duration_sec: Number(payload.batch_total_drying_sec ?? (existingBatch ? existingBatch.total_duration_sec : 0)),
      formatted_total: payload.formatted_batch_total || '00:00:00',
      last_session_id: Math.max(sessionIdNum, existingBatch ? existingBatch.last_session_id || 0 : 0),
      status: eventType === 'BATCH_RESET' ? 'COMPLETED_RESET' : (eventType === 'SESSION_OPENED' ? 'ACTIVE_DRYING' : 'PAUSED_RETRACTED'),
    };
    await this._saveDoc(this.config.firestore.collections.batches, batchId, batchDoc, true);

    // 2. Nếu là sự kiện đóng phiên hoặc phiên bị gián đoạn do mất điện, lưu bản ghi `drying_sessions`
    if (eventType === 'SESSION_CLOSED' || eventType === 'SESSION_INTERRUPTED_POWER' || eventType === 'SESSION_OPENED') {
      const docId = `${batchId}_S${String(sessionIdNum).padStart(3, '0')}`;
      const sessionDoc = {
        doc_id: docId,
        batch_id: batchId,
        session_id: sessionIdNum,
        group_id: payload.group_id || this.config.groupId,
        device_id: deviceId,
        is_simulation: false,
        status: eventType === 'SESSION_OPENED' ? 'OPEN' : (payload.interrupted ? 'INTERRUPTED_POWER' : 'CLOSED'),
        start_epoch: startEpochSec,
        end_epoch: eventType === 'SESSION_OPENED' ? null : endEpochSec,
        start_time_ms: startMs,
        end_time_ms: eventType === 'SESSION_OPENED' ? null : endMs,
        start_time_iso: new Date(startMs).toISOString(),
        end_time_iso: eventType === 'SESSION_OPENED' ? null : new Date(endMs).toISOString(),
        time_synced: Boolean(payload.time_synced),
        duration_sec: Number(payload.session_duration_sec || 0),
        batch_total_drying_sec: Number(payload.batch_total_drying_sec || 0),
        formatted_batch_total: payload.formatted_batch_total || '00:00:00',
        trigger_mode: payload.trigger_mode || 'AUTO',
        retract_reason: payload.reason || 'NONE',
        retract_reason_vi: payload.reason_vi || '',
        interrupted: Boolean(payload.interrupted),
        sensors_snapshot: payload.sensors_snapshot || {},
        updated_at_ms: nowMs,
      };

      await this._saveDoc(this.config.firestore.collections.dryingSessions, docId, sessionDoc, true);
      return { saved: true, batchDoc, sessionDoc };
    }

    return { saved: true, batchDoc, sessionDoc: null };
  }

  /**
   * [W18 - F19] Lưu sự kiện đổi trạng thái và cảnh báo vào collection `events`
   */
  async handleAlertEvent(payload, notificationResult = null, nowMs = Date.now()) {
    if (!payload || typeof payload !== 'object') {
      return { saved: false, reason: 'INVALID_PAYLOAD' };
    }
    if (payload.is_simulation === true) {
      return { saved: false, reason: 'SIMULATION_MODE_IGNORED' };
    }

    const deviceId = payload.device_id || this.config.deviceId;
    const timestampMs = this.resolveTimestampMs(payload, nowMs);
    const eventId = payload.event_id || `EVT_${deviceId}_${timestampMs}`;

    const eventDoc = {
      event_id: eventId,
      group_id: payload.group_id || this.config.groupId,
      device_id: deviceId,
      is_simulation: false,
      timestamp_ms: timestampMs,
      created_at_iso: new Date(timestampMs).toISOString(),
      time_synced: Boolean(payload.time_synced),
      event_code: payload.event_code || 'UNKNOWN',
      title_vi: payload.title_vi || 'Sự kiện hệ thống',
      message_vi: payload.message_vi || '',
      batch_id: payload.batch_id || null,
      session_id: Number(payload.session_id || 0),
      total_drying_sec: Number(payload.total_drying_sec || 0),
      formatted_time: payload.formatted_time || '00:00:00',
      rod_state: payload.rod_state || 'RETRACTED',
      control_mode: payload.control_mode || 'AUTO',
      sensors: payload.sensors || {},
      channels: Array.isArray(payload.channels) ? payload.channels : [],
      notification_status: notificationResult || { status: 'NOT_REQUIRED' },
    };

    await this._saveDoc(this.config.firestore.collections.events, eventId, eventDoc, true);
    return { saved: true, eventId, eventDoc };
  }

  // ==========================================================================
  // CÁC HÀM NỘI BỘ HỖ TRỢ CẢ FIRESTORE THẬT LẪN BỘ NHỚ CỤC BỘ
  // ==========================================================================
  async _getBatch(batchId) {
    this.initFirebase();
    if (this.db) {
      const snap = await this.db.collection(this.config.firestore.collections.batches).doc(batchId).get();
      return snap.exists ? snap.data() : null;
    }
    return this.memoryStore.batches.get(batchId) || null;
  }

  async _saveDoc(collectionName, docId, data, merge = true) {
    this.initFirebase();
    if (this.db) {
      await this.db.collection(collectionName).doc(docId).set(data, { merge });
      return;
    }

    // Lưu vào bộ nhớ cục bộ (Memory Store)
    if (collectionName === this.config.firestore.collections.devices) {
      this.memoryStore.devices.set(docId, data);
    } else if (collectionName === this.config.firestore.collections.batches) {
      const prev = this.memoryStore.batches.get(docId) || {};
      this.memoryStore.batches.set(docId, merge ? { ...prev, ...data } : data);
    } else if (collectionName === this.config.firestore.collections.sensorSamples) {
      this.memoryStore.sensor_samples.push(data);
    } else if (collectionName === this.config.firestore.collections.dryingSessions) {
      const idx = this.memoryStore.drying_sessions.findIndex((s) => s.doc_id === docId);
      if (idx >= 0) {
        this.memoryStore.drying_sessions[idx] = merge
          ? { ...this.memoryStore.drying_sessions[idx], ...data }
          : data;
      } else {
        this.memoryStore.drying_sessions.push(data);
      }
    } else if (collectionName === this.config.firestore.collections.events) {
      const idx = this.memoryStore.events.findIndex((e) => e.event_id === docId);
      if (idx >= 0) {
        this.memoryStore.events[idx] = merge ? { ...this.memoryStore.events[idx], ...data } : data;
      } else {
        this.memoryStore.events.push(data);
      }
    } else if (collectionName === (this.config.firestore.collections.users || 'users')) {
      const prev = this.memoryStore.users.get(docId) || {};
      this.memoryStore.users.set(docId, merge ? { ...prev, ...data } : data);
    }
  }

  /**
   * Truy vấn danh sách email của người dùng sở hữu device_id cụ thể từ Firestore
   * Dùng để gửi email cảnh báo đúng người dùng sở hữu thiết bị đó.
   */
  async getUserEmailsByDeviceId(deviceId) {
    if (!deviceId) return [];
    this.initFirebase();
    if (this.db) {
      try {
        const usersCol = this.config.firestore.collections.users || 'users';
        const snap = await this.db.collection(usersCol).where('device_id', '==', deviceId).get();
        const emails = [];
        snap.forEach((doc) => {
          const u = doc.data();
          if (u && u.email && typeof u.email === 'string') {
            emails.push(u.email.trim());
          }
        });
        if (emails.length > 0) return [...new Set(emails)];
      } catch (err) {
        // Fallback sang memoryStore nếu lỗi truy vấn Firestore
      }
    }

    const memoryEmails = [];
    for (const [_, u] of this.memoryStore.users.entries()) {
      if (u && u.device_id === deviceId && u.email) {
        memoryEmails.push(u.email.trim());
      }
    }
    return [...new Set(memoryEmails)];
  }

  /**
   * Lưu hoặc cập nhật thông tin người dùng kèm device_id vào collection `users`
   */
  async setUserProfile(userId, userData) {
    if (!userId || !userData) return;
    const usersCol = this.config.firestore.collections.users || 'users';
    await this._saveDoc(usersCol, userId, {
      user_id: userId,
      ...userData,
      updated_at_ms: Date.now(),
    });
  }
}

module.exports = { FirestoreService };
