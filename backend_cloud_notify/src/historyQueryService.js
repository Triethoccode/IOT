/**
 * W19 (Phần của Phong) – TRUY VẤN DỮ LIỆU LỊCH SỬ 24 GIỜ TỪ FIRESTORE
 * Phụ trách: Tạ Bỉnh Phong (24127100) – Cung cấp dữ liệu lịch sử cho Triết vẽ biểu đồ & hiển thị nhật ký
 */
const defaultConfig = require('./config');

function formatDurationHMS(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec || 0)));
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

class HistoryQueryService {
  constructor(firestoreService, customConfig = {}) {
    this.firestoreService = firestoreService;
    this.config = {
      ...defaultConfig,
      ...customConfig,
      firestore: {
        ...defaultConfig.firestore,
        ...(customConfig.firestore || {}),
        collections: {
          ...defaultConfig.firestore.collections,
          ...((customConfig.firestore && customConfig.firestore.collections) || {}),
        },
      },
    };
  }

  /**
   * [W19 - Phong] Truy vấn toàn bộ dữ liệu lịch sử 24 giờ gần nhất cho Dashboard của Triết:
   * 1. Chuỗi mẫu nhiệt độ & độ ẩm 24h (kèm phát hiện khoảng trống mất mạng, không tự tạo dữ liệu bù)
   * 2. Danh sách phiên phơi trong 24h, tổng thời gian phơi và nguyên nhân thu sào
   * 3. Danh sách sự kiện cảnh báo / thu sào do mưa hoặc thao tác người dùng
   */
  async getHistoryLast24Hours(options = {}) {
    const deviceId = options.deviceId || this.config.deviceId;
    const nowMs = options.nowMs || Date.now();
    const hours = Number(options.hours || 24);
    const sinceMs = nowMs - hours * 3600 * 1000;

    // Giới hạn số bản ghi truy vấn (Mục 3.7: "Truy vấn được giới hạn số bản ghi")
    const maxSamples = Number(options.maxSamples || 1440); // 24h * 60 mẫu/giờ
    const maxSessions = Number(options.maxSessions || 100);
    const maxEvents = Number(options.maxEvents || 100);
    // Khoảng cách giữa 2 mẫu vượt quá 3 lần chu kỳ 60s (> 180s) được đánh dấu là khoảng trống mất mạng
    const gapThresholdMs = Number(
      options.gapThresholdMs || this.config.firestore.sampleSaveIntervalMs * 3
    );

    const [samples, sessions, events, batches] = await Promise.all([
      this._querySensorSamples(deviceId, sinceMs, nowMs, maxSamples),
      this._queryDryingSessions(deviceId, sinceMs, nowMs, maxSessions),
      this._queryEvents(deviceId, sinceMs, nowMs, maxEvents),
      this._queryBatches(deviceId),
    ]);

    // Phát hiện các khoảng trống dữ liệu (Offline gaps) và gắn điểm ngắt đoạn (null) cho biểu đồ
    // Tuyệt đối không nội suy / tự bịa dữ liệu bù (Mục 3.7)
    const { chartPoints, detectedGaps } = this._buildChartSeriesWithGaps(samples, gapThresholdMs);

    // Tính tổng thời gian phơi trong 24h và tổng của mẻ hiện hành
    const totalDryingSec24h = sessions.reduce((acc, s) => acc + Number(s.duration_sec || 0), 0);
    const activeBatch = batches.length > 0 ? batches[0] : null;

    // Chuẩn hóa danh sách nhật ký phiên phơi & nguyên nhân thu sào cho Triết hiển thị
    const sessionLogs = sessions.map((s) => ({
      doc_id: s.doc_id,
      batch_id: s.batch_id,
      session_id: s.session_id,
      status: s.status,
      start_time_ms: s.start_time_ms,
      end_time_ms: s.end_time_ms,
      start_time_iso: s.start_time_iso,
      end_time_iso: s.end_time_iso,
      duration_sec: s.duration_sec,
      duration_hms: formatDurationHMS(s.duration_sec),
      batch_total_drying_sec: s.batch_total_drying_sec,
      batch_total_hms: s.formatted_batch_total || formatDurationHMS(s.batch_total_drying_sec),
      trigger_mode: s.trigger_mode,
      retract_reason: s.retract_reason,
      retract_reason_vi: s.retract_reason_vi,
      interrupted: Boolean(s.interrupted),
      time_synced: Boolean(s.time_synced),
    }));

    const eventLogs = events.map((e) => ({
      event_id: e.event_id,
      timestamp_ms: e.timestamp_ms,
      created_at_iso: e.created_at_iso,
      event_code: e.event_code,
      title_vi: e.title_vi,
      message_vi: e.message_vi,
      batch_id: e.batch_id,
      total_drying_sec: e.total_drying_sec,
      formatted_time: e.formatted_time || formatDurationHMS(e.total_drying_sec),
      rod_state: e.rod_state,
      control_mode: e.control_mode,
      notification_status: e.notification_status,
    }));

    const hasData = samples.length > 0 || sessionLogs.length > 0 || eventLogs.length > 0;

    return {
      ok: true,
      device_id: deviceId,
      window: {
        hours,
        from_ms: sinceMs,
        to_ms: nowMs,
        from_iso: new Date(sinceMs).toISOString(),
        to_iso: new Date(nowMs).toISOString(),
      },
      // Xử lý rõ trường hợp chưa có dữ liệu (Bảng 5.4 - W19)
      has_data: hasData,
      empty_state_message_vi: hasData
        ? null
        : 'Chưa có dữ liệu lịch sử trong 24 giờ gần nhất.',

      // Dữ liệu biểu đồ nhiệt độ & độ ẩm 24h cho Triết
      chart_24h: {
        sample_count: samples.length,
        gap_count: detectedGaps.length,
        gaps: detectedGaps,
        points: chartPoints,
      },

      // Tổng hợp mẻ đồ & phiên phơi trong 24h cho Triết
      drying_summary: {
        active_batch: activeBatch
          ? {
              batch_id: activeBatch.batch_id,
              status: activeBatch.status,
              total_duration_sec: activeBatch.total_duration_sec,
              formatted_total:
                activeBatch.formatted_total || formatDurationHMS(activeBatch.total_duration_sec),
              last_session_id: activeBatch.last_session_id,
            }
          : null,
        sessions_in_24h_count: sessionLogs.length,
        total_drying_sec_in_24h: totalDryingSec24h,
        formatted_total_in_24h: formatDurationHMS(totalDryingSec24h),
      },

      // Danh sách phiên phơi & sự kiện thu sào cho bảng nhật ký của Triết
      session_logs: sessionLogs,
      event_logs: eventLogs,
    };
  }

  /**
   * Phát hiện khoảng trống do mất mạng / mất điện giữa các mẫu 60s.
   * Khi phát hiện khoảng trống > gapThresholdMs, chèn một điểm marker có temperature_c = null,
   * humidity_pct = null, is_gap_marker = true để biểu đồ của Triết tự ngắt nét vẽ (spanGaps: false)
   * thay vì nối thẳng giả tạo qua khoảng thời gian mất mạng (Mục 3.7).
   */
  _buildChartSeriesWithGaps(samples, gapThresholdMs) {
    const chartPoints = [];
    const detectedGaps = [];

    for (let i = 0; i < samples.length; i++) {
      const curr = samples[i];
      if (i > 0) {
        const prev = samples[i - 1];
        const deltaMs = curr.timestamp_ms - prev.timestamp_ms;
        if (deltaMs > gapThresholdMs) {
          const gapMidMs = Math.floor((prev.timestamp_ms + curr.timestamp_ms) / 2);
          detectedGaps.push({
            from_ms: prev.timestamp_ms,
            to_ms: curr.timestamp_ms,
            from_iso: new Date(prev.timestamp_ms).toISOString(),
            to_iso: new Date(curr.timestamp_ms).toISOString(),
            duration_sec: Math.round(deltaMs / 1000),
          });
          // Chèn điểm null để ngắt đường biểu đồ đúng thực tế, không tự tạo dữ liệu bù
          chartPoints.push({
            timestamp_ms: gapMidMs,
            iso_time: new Date(gapMidMs).toISOString(),
            dht_valid: false,
            temperature_c: null,
            humidity_pct: null,
            wet_percent: null,
            is_gap_marker: true,
          });
        }
      }

      chartPoints.push({
        timestamp_ms: curr.timestamp_ms,
        iso_time: curr.recorded_at_iso || new Date(curr.timestamp_ms).toISOString(),
        dht_valid: Boolean(curr.dht_valid),
        // Nếu mẫu tại thời điểm đó bị lỗi DHT11 (dht_valid == false), giữ nguyên null
        temperature_c: curr.dht_valid ? curr.temperature_c : null,
        humidity_pct: curr.dht_valid ? curr.humidity_pct : null,
        wet_percent: curr.wet_percent,
        wet_label: curr.wet_label,
        rod_state: curr.rod_state,
        is_gap_marker: false,
      });
    }

    return { chartPoints, detectedGaps };
  }

  async _querySensorSamples(deviceId, sinceMs, nowMs, limit) {
    this.firestoreService.initFirebase();
    const db = this.firestoreService.db;
    const col = this.config.firestore.collections.sensorSamples;

    if (db) {
      const snap = await db
        .collection(col)
        .where('device_id', '==', deviceId)
        .where('timestamp_ms', '>=', sinceMs)
        .where('timestamp_ms', '<=', nowMs)
        .orderBy('timestamp_ms', 'asc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data()).filter((d) => !d.is_simulation);
    }

    return this.firestoreService.memoryStore.sensor_samples
      .filter(
        (s) =>
          s.device_id === deviceId &&
          !s.is_simulation &&
          s.timestamp_ms >= sinceMs &&
          s.timestamp_ms <= nowMs
      )
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
      .slice(-limit);
  }

  async _queryDryingSessions(deviceId, sinceMs, nowMs, limit) {
    this.firestoreService.initFirebase();
    const db = this.firestoreService.db;
    const col = this.config.firestore.collections.dryingSessions;

    if (db) {
      const snap = await db
        .collection(col)
        .where('device_id', '==', deviceId)
        .where('updated_at_ms', '>=', sinceMs)
        .orderBy('updated_at_ms', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data()).filter((d) => !d.is_simulation);
    }

    return this.firestoreService.memoryStore.drying_sessions
      .filter(
        (s) =>
          s.device_id === deviceId &&
          !s.is_simulation &&
          (s.updated_at_ms || s.start_time_ms) >= sinceMs &&
          (s.start_time_ms || 0) <= nowMs
      )
      .sort((a, b) => (b.updated_at_ms || b.start_time_ms) - (a.updated_at_ms || a.start_time_ms))
      .slice(0, limit);
  }

  async _queryEvents(deviceId, sinceMs, nowMs, limit) {
    this.firestoreService.initFirebase();
    const db = this.firestoreService.db;
    const col = this.config.firestore.collections.events;

    if (db) {
      const snap = await db
        .collection(col)
        .where('device_id', '==', deviceId)
        .where('timestamp_ms', '>=', sinceMs)
        .where('timestamp_ms', '<=', nowMs)
        .orderBy('timestamp_ms', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data()).filter((d) => !d.is_simulation);
    }

    return this.firestoreService.memoryStore.events
      .filter(
        (e) =>
          e.device_id === deviceId &&
          !e.is_simulation &&
          e.timestamp_ms >= sinceMs &&
          e.timestamp_ms <= nowMs
      )
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, limit);
  }

  async _queryBatches(deviceId) {
    this.firestoreService.initFirebase();
    const db = this.firestoreService.db;
    const col = this.config.firestore.collections.batches;

    if (db) {
      const snap = await db
        .collection(col)
        .where('device_id', '==', deviceId)
        .orderBy('updated_at_ms', 'desc')
        .limit(10)
        .get();
      return snap.docs.map((d) => d.data()).filter((d) => !d.is_simulation);
    }

    return Array.from(this.firestoreService.memoryStore.batches.values())
      .filter((b) => b.device_id === deviceId && !b.is_simulation)
      .sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0));
  }
}

module.exports = { HistoryQueryService, formatDurationHMS };
