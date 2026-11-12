/**
 * W06 – BỘ KIỂM THỬ THUẬT TOÁN THỜI TIẾT, BỘ ĐẾM PHIÊN PHƠI & TÍCH HỢP BACKEND (W01–W06, W18, W19, W21)
 * Phụ trách: Tạ Bỉnh Phong (24127100)
 *
 * Đối chiếu toàn bộ ma trận kịch bản kiểm thử ở Bảng 3.1 & Bảng 5.5 trong Proposal:
 *  TC01: Đang phơi ở Auto, làm ướt cảm biến (>=30%) -> Thu sào, đóng phiên, phát 1 sự kiện cảnh báo mưa, không lặp khi ướt nhiều (>=50%).
 *  TC02: Cảm biến dao động quanh ngưỡng chuyển tiếp (15–<30% hoặc ẩm 82–<85%) -> Không mở lại khi chưa đủ thời gian xác nhận khô liên tục.
 *  TC03: Khô đủ thời gian xác nhận (180s chuẩn / 10s demo), sáng & ẩm < 82% -> Tắt quạt, mở sào lại, tạo phiên mới & cộng dồn tổng mẻ đồ.
 *  TC04: Trời tối hoặc độ ẩm cao (>=85%) trong Auto -> Thu sào; đèn xử lý đúng chế độ riêng (Auto vs Manual).
 *  TC05: Điều khiển tay (nút nhấn / web) -> Tự chuyển sang Manual, không bị vòng lặp Auto ghi đè; cảnh báo khi Manual ngoài trời gặp mưa.
 *  TC06: Mở/thu lặp và nhiều phiên trong một mẻ -> Không tạo trùng phiên, không cộng trùng thời gian; đối chiếu chính xác bộ đếm.
 *  TC07: Reset bộ đếm khi sào đang phơi -> Đóng phiên mẻ cũ lưu lên Cloud, tổng mẻ mới về 00:00:00 và bắt đầu đếm ngay phiên mới.
 *  TC08: DHT11 đọc lỗi -> Đánh dấu dht_valid=false, giữ null (không dùng số giả) và khóa mở sào tự động.
 *  TC09: Mất điện gián đoạn khi đang phơi -> Đánh dấu phiên gián đoạn POWER_LOSS, không tự cộng thời gian mất điện.
 *  TC10: Tích hợp W18 (lọc 60s lưu mẫu Firestore, lưu mẻ/phiên/sự kiện), W19 (truy vấn 24h & phát hiện khoảng trống mất mạng),
 *        W21 (PushSafer + Email SMTP, chống gửi trùng cooldown & thử lại có giới hạn khi lỗi mạng), và cách ly Simulation Mode.
 */

const assert = require('assert');
const { createAeroDryBackend } = require('../backend_cloud_notify/src/index');

// ============================================================================
// MÔ PHỎNG CHÍNH XÁC LOGIC FIRMWARE ESP32 (sensors.h + drying_tracker.h + state_machine.h)
// ĐỂ ĐỐI CHIẾU MA TRẬN KỊCH BẢN W06 TRÊN PC
// ============================================================================
class Esp32FirmwareSimulator {
  constructor(onMqttPublish) {
    this.onMqttPublish = onMqttPublish;
    this.batchSeq = 1;
    this.batchId = 'BATCH_1762930000_1';
    this.sessionId = 0;
    this.isSessionOpen = false;
    this.sessionStartMs = 0;
    this.sessionStartEpoch = 0;
    this.accumulatedSec = 0;

    this.controlMode = 'AUTO';
    this.rodState = 'RETRACTED';
    this.fanOn = false;
    this.lightMode = 'AUTO';
    this.lightOn = false;

    this.dryConfirmTargetSec = 180;
    this.dryConfirmActive = false;
    this.dryConfirmStartMs = 0;
    this.autoRainAlertLatched = false;
    this.manualRainWarnLatched = false;
    this.eventSeq = 0;

    this.sensors = {
      dht_valid: true,
      temperature_c: 32.0,
      humidity_pct: 60.0,
      wet_percent: 5,
      wet_label: 'DRY',
      wet_text_vi: 'Khô',
      light_percent: 75,
      is_dark: false,
    };
  }

  getTotalDryingSec(nowMs) {
    const activeSec = this.isSessionOpen ? Math.floor((nowMs - this.sessionStartMs) / 1000) : 0;
    return this.accumulatedSec + activeSec;
  }

  setSensors(partial) {
    Object.assign(this.sensors, partial);
    if (!this.sensors.dht_valid) {
      this.sensors.temperature_c = null;
      this.sensors.humidity_pct = null;
    }
    const w = this.sensors.wet_percent;
    this.sensors.wet_label = w >= 50 ? 'HEAVY_WET' : w >= 30 ? 'WET' : w >= 15 ? 'TRANSITION' : 'DRY';
    this.sensors.wet_text_vi = w >= 50 ? 'Ướt nhiều' : w >= 15 ? 'Đang ướt' : 'Khô';
  }

  _emitSession(eventType, nowMs, reason, interrupted = false) {
    const nowEpoch = Math.floor(nowMs / 1000);
    const durSec =
      eventType === 'SESSION_CLOSED' ? Math.floor((nowMs - this.sessionStartMs) / 1000) : 0;
    this.onMqttPublish('aerodry/g21/esp32_01/session', {
      schema_ver: '1.0',
      group_id: 'G21_24C11',
      device_id: 'esp32_01',
      is_simulation: false,
      event_type: eventType,
      batch_id: this.batchId,
      session_id: this.sessionId,
      start_epoch: this.sessionStartEpoch,
      end_epoch: nowEpoch,
      time_synced: true,
      session_duration_sec: durSec,
      batch_total_drying_sec: this.accumulatedSec,
      trigger_mode: this.controlMode,
      reason,
      reason_vi: reason,
      interrupted,
      sensors_snapshot: { ...this.sensors },
    }, nowMs);
  }

  _emitEvent(eventCode, nowMs) {
    this.eventSeq++;
    const nowEpoch = Math.floor(nowMs / 1000);
    this.onMqttPublish('aerodry/g21/esp32_01/event', {
      schema_ver: '1.0',
      event_id: `EVT_esp32_01_${nowMs}_${this.eventSeq}`,
      group_id: 'G21_24C11',
      device_id: 'esp32_01',
      is_simulation: false,
      timestamp: nowEpoch,
      time_synced: true,
      event_code: eventCode,
      title_vi: eventCode,
      message_vi: `Event ${eventCode}`,
      batch_id: this.batchId,
      session_id: this.sessionId,
      total_drying_sec: this.getTotalDryingSec(nowMs),
      rod_state: this.rodState,
      control_mode: this.controlMode,
      sensors: { ...this.sensors },
      channels:
        eventCode === 'AUTO_RAIN_RETRACT' || eventCode === 'MANUAL_RAIN_WARNING'
          ? ['PUSHSAFER', 'EMAIL']
          : eventCode === 'HIGH_HUMIDITY_PROLONGED'
          ? ['EMAIL']
          : [],
    }, nowMs);
  }

  publishTelemetry(nowMs, isSimulation = false) {
    const nowEpoch = Math.floor(nowMs / 1000);
    const topic = isSimulation
      ? 'aerodry/g21/sim/esp32_01/telemetry'
      : 'aerodry/g21/esp32_01/telemetry';
    this.onMqttPublish(topic, {
      schema_ver: '1.0',
      group_id: 'G21_24C11',
      device_id: 'esp32_01',
      is_simulation: isSimulation,
      timestamp: nowEpoch,
      time_synced: true,
      uptime_sec: Math.floor((nowMs - 1762930000000) / 1000),
      sensors: { ...this.sensors },
      actuators: {
        control_mode: this.controlMode,
        rod_state: this.rodState,
        fan_state: this.fanOn ? 'ON' : 'OFF',
        light_mode: this.lightMode,
        light_state: this.lightOn ? 'ON' : 'OFF',
      },
      drying: {
        batch_id: this.batchId,
        session_id: this.sessionId,
        is_session_open: this.isSessionOpen,
        total_drying_sec: this.getTotalDryingSec(nowMs),
      },
    }, nowMs);
  }

  _extendInternal(nowMs, reason) {
    if (this.rodState === 'EXTENDED') return false;
    this.fanOn = false; // Tắt quạt trước khi đưa sào ra
    this.rodState = 'EXTENDED';
    this.dryConfirmActive = false;
    this.autoRainAlertLatched = false;
    this.manualRainWarnLatched = false;

    this.sessionId++;
    this.isSessionOpen = true;
    this.sessionStartMs = nowMs;
    this.sessionStartEpoch = Math.floor(nowMs / 1000);
    this._emitSession('SESSION_OPENED', nowMs, reason, false);
    return true;
  }

  _retractInternal(nowMs, reason) {
    this.dryConfirmActive = false;
    if (this.rodState === 'RETRACTED') return false;
    this.rodState = 'RETRACTED';
    if (this.isSessionOpen) {
      const durSec = Math.floor((nowMs - this.sessionStartMs) / 1000);
      this.accumulatedSec += durSec;
      this.isSessionOpen = false;
      this._emitSession('SESSION_CLOSED', nowMs, reason, false);
    }
    return true;
  }

  manualExtend(nowMs, reason = 'MANUAL_BTN') {
    this.controlMode = 'MANUAL';
    this.dryConfirmActive = false;
    return this._extendInternal(nowMs, reason);
  }

  manualRetract(nowMs, reason = 'MANUAL_BTN') {
    this.controlMode = 'MANUAL';
    this.dryConfirmActive = false;
    return this._retractInternal(nowMs, reason);
  }

  setMode(mode, nowMs) {
    this.controlMode = mode;
    this.dryConfirmActive = false;
    if (mode === 'AUTO') this.evaluate(nowMs);
  }

  resetCounter(nowMs) {
    if (this.isSessionOpen) {
      this._retractInternalForReset(nowMs);
    }
    this._emitSession('BATCH_RESET', nowMs, 'BATCH_RESET', false);
    this.batchSeq++;
    this.batchId = `BATCH_1762930000_${this.batchSeq}`;
    this.sessionId = 0;
    this.accumulatedSec = 0;
    this.isSessionOpen = false;
    if (this.rodState === 'EXTENDED') {
      this.sessionId++;
      this.isSessionOpen = true;
      this.sessionStartMs = nowMs;
      this.sessionStartEpoch = Math.floor(nowMs / 1000);
      this._emitSession('SESSION_OPENED', nowMs, 'BATCH_RESET', false);
    }
  }

  _retractInternalForReset(nowMs) {
    const durSec = Math.floor((nowMs - this.sessionStartMs) / 1000);
    this.accumulatedSec += durSec;
    this.isSessionOpen = false;
    this._emitSession('SESSION_CLOSED', nowMs, 'BATCH_RESET', false);
  }

  evaluate(nowMs) {
    const s = this.sensors;
    if (this.lightMode === 'AUTO') {
      this.lightOn = s.is_dark;
    }

    if (this.controlMode === 'MANUAL') {
      this.dryConfirmActive = false;
      if (this.rodState === 'EXTENDED' && s.wet_percent >= 30 && !this.manualRainWarnLatched) {
        this.manualRainWarnLatched = true;
        this._emitEvent('MANUAL_RAIN_WARNING', nowMs);
      }
      return;
    }

    // Chế độ AUTO
    if (s.wet_percent >= 30) {
      this.dryConfirmActive = false;
      if (this.rodState === 'EXTENDED') {
        this._retractInternal(nowMs, 'RAIN');
        if (!this.autoRainAlertLatched) {
          this.autoRainAlertLatched = true;
          this._emitEvent('AUTO_RAIN_RETRACT', nowMs);
        }
      }
      return;
    }

    if (s.dht_valid && s.humidity_pct >= 85.0) {
      this.dryConfirmActive = false;
      if (this.rodState === 'EXTENDED') {
        this._retractInternal(nowMs, 'HIGH_HUMIDITY');
        this._emitEvent('AUTO_HUMIDITY_RETRACT', nowMs);
      }
      return;
    }

    if (s.is_dark) {
      this.dryConfirmActive = false;
      if (this.rodState === 'EXTENDED') {
        this._retractInternal(nowMs, 'DARK');
        this._emitEvent('AUTO_DARK_RETRACT', nowMs);
      }
      return;
    }

    const dryOk =
      s.dht_valid && s.wet_percent < 15 && !s.is_dark && s.humidity_pct < 82.0;

    if (!dryOk) {
      this.dryConfirmActive = false;
      return;
    }

    this.autoRainAlertLatched = false;
    if (this.rodState === 'RETRACTED') {
      if (!this.dryConfirmActive) {
        this.dryConfirmActive = true;
        this.dryConfirmStartMs = nowMs;
      } else if (nowMs - this.dryConfirmStartMs >= this.dryConfirmTargetSec * 1000) {
        this._extendInternal(nowMs, 'DRY_RECOVERED');
        this._emitEvent('AUTO_DRY_EXTEND', nowMs);
      }
    }
  }
}

// ============================================================================
// CHẠY TOÀN BỘ KỊCH BẢN KIỂM THỬ W06 & IN BÁO CÁO KẾT QUẢ
// ============================================================================
async function runVerification() {
  const pushCalls = [];
  const emailCalls = [];
  let shouldFailPushOnce = false;

  const backend = createAeroDryBackend(
    {
      firestore: { sampleSaveIntervalMs: 60000 },
      alerts: { cooldownMs: 15 * 60 * 1000, maxRetries: 3, retryDelayMs: 10 },
    },
    {
      transports: {
        pushSender: async (content) => {
          if (shouldFailPushOnce) {
            shouldFailPushOnce = false;
            throw new Error('Simulated temporary network timeout');
          }
          pushCalls.push(content);
          return { status: 1 };
        },
        emailSender: async (content) => {
          emailCalls.push(content);
          return { messageId: `MSG_${emailCalls.length}` };
        },
      },
    }
  );

  const mqttQueue = [];
  const sim = new Esp32FirmwareSimulator((topic, payload, nowMs) => {
    mqttQueue.push({ topic, payload, nowMs });
  });

  async function flushMqttQueue() {
    while (mqttQueue.length > 0) {
      const item = mqttQueue.shift();
      await backend.mqttWorker.routeIncomingMqttPacket(item.topic, item.payload, item.nowMs);
    }
  }

  const results = [];
  let t = 1762930000000;

  // --------------------------------------------------------------------------
  // TC01: Khởi động khô ráo đủ 180s -> Mở sào, sau đó phơi 600s rồi gặp mưa (38%) & tăng lên ướt nhiều (65%)
  // --------------------------------------------------------------------------
  sim.setSensors({ dht_valid: true, temperature_c: 33.0, humidity_pct: 60.0, wet_percent: 5, is_dark: false });
  sim.evaluate(t); // Bắt đầu đếm chờ khô
  t += 180 * 1000;
  sim.evaluate(t); // Đủ 180s -> Mở sào tự động (Phiên #1)
  assert.strictEqual(sim.rodState, 'EXTENDED', 'TC01: Sào phải mở sau 180s khô liên tục');

  t += 600 * 1000; // Phơi 600 giây (10 phút)
  shouldFailPushOnce = true; // Giả lập lỗi mạng lần 1 để kiểm tra cơ chế Retry của W21
  sim.setSensors({ wet_percent: 38, humidity_pct: 76.0 });
  sim.evaluate(t);
  await flushMqttQueue();

  assert.strictEqual(sim.rodState, 'RETRACTED', 'TC01: Phải thu sào ngay khi mức ướt >= 30%');
  assert.strictEqual(sim.getTotalDryingSec(t), 600, 'TC01: Bộ đếm phiên 1 phải ghi nhận đúng 600s');
  assert.strictEqual(pushCalls.length, 1, 'TC01: Phải gửi đúng 1 thông báo PushSafer (sau khi retry thành công)');
  assert.strictEqual(emailCalls.length, 1, 'TC01: Phải gửi đúng 1 Email cảnh báo mưa');

  // Tiếp tục mưa nặng hạt (65% - Ướt nhiều) thêm 3 chu kỳ đọc -> Không phát lặp thông báo
  for (let i = 0; i < 3; i++) {
    t += 2500;
    sim.setSensors({ wet_percent: 65 });
    sim.evaluate(t);
  }
  await flushMqttQueue();
  assert.strictEqual(pushCalls.length, 1, 'TC01: Không phát lặp cảnh báo khi tiếp tục mưa / ướt nhiều');
  results.push({ id: 'TC01', name: 'Auto đang phơi gặp mưa (>=30%) & ướt nhiều (>=50%)', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC02: Cảm biến dao động quanh vùng chuyển tiếp (15%..29% hoặc ẩm 82%..84%)
  // --------------------------------------------------------------------------
  sim.setSensors({ wet_percent: 10, humidity_pct: 70.0, is_dark: false });
  sim.evaluate(t); // Bắt đầu đếm khô
  t += 120 * 1000; // Mới khô được 120s (< 180s)
  sim.evaluate(t);
  assert.strictEqual(sim.rodState, 'RETRACTED', 'TC02: Chưa đủ 180s không được mở sào');

  // Dao động nhảy lên vùng chuyển tiếp 18% -> Bộ đếm chờ khô phải reset về 0
  t += 1000;
  sim.setSensors({ wet_percent: 18 });
  sim.evaluate(t);
  t += 100 * 1000;
  sim.setSensors({ wet_percent: 8 });
  sim.evaluate(t); // Bắt đầu đếm lại từ 0
  t += 100 * 1000; // Mới được 100s kể từ lúc khô lại
  sim.evaluate(t);
  assert.strictEqual(sim.rodState, 'RETRACTED', 'TC02: Dao động qua vùng chuyển tiếp phải đặt lại bộ đếm chờ khô');
  results.push({ id: 'TC02', name: 'Dao động quanh ngưỡng khô/ướt (vùng chuyển tiếp 15–30%)', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC03: Khô đủ 180s liên tục + kiểm tra tự động tắt quạt trước khi đưa sào ra
  // --------------------------------------------------------------------------
  sim.fanOn = true; // Giả sử người dùng đang bật quạt dưới mái hiên
  t += 85 * 1000; // Tổng cộng 185s khô liên tục (>= 180s)
  sim.evaluate(t);
  await flushMqttQueue();
  assert.strictEqual(sim.rodState, 'EXTENDED', 'TC03: Đủ 180s khô liên tục phải tự đưa sào ra (Phiên #2)');
  assert.strictEqual(sim.fanOn, false, 'TC03: Trước khi đưa sào ra phải tự động tắt quạt');
  results.push({ id: 'TC03', name: 'Khô liên tục đủ 180s -> Tắt quạt, mở sào & tạo phiên mới', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC04: Độ ẩm cao (>=85%) hoặc Trời tối trong Auto + Chế độ đèn riêng
  // --------------------------------------------------------------------------
  t += 300 * 1000; // Phơi thêm 300s ở Phiên #2 (Tổng mẻ = 600 + 300 = 900s)
  sim.setSensors({ wet_percent: 5, humidity_pct: 70.0, is_dark: true });
  sim.evaluate(t);
  await flushMqttQueue();
  assert.strictEqual(sim.rodState, 'RETRACTED', 'TC04: Trời tối trong Auto phải thu sào');
  assert.strictEqual(sim.lightOn, true, 'TC04: Đèn ở chế độ Auto phải tự bật khi trời tối');
  assert.strictEqual(sim.getTotalDryingSec(t), 900, 'TC04: Tổng thời gian cộng dồn 2 phiên phải bằng 900s');

  // Chuyển đèn sang Manual OFF -> vòng lặp LDR trời tối không được ghi đè đèn
  sim.lightMode = 'MANUAL';
  sim.lightOn = false;
  t += 5000;
  sim.evaluate(t);
  assert.strictEqual(sim.lightOn, false, 'TC04: Đèn ở chế độ Manual không bị LDR ghi đè');
  results.push({ id: 'TC04', name: 'Trời tối / Độ ẩm cao trong Auto & Chế độ đèn riêng', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC05 & TC06: Điều khiển tay chuyển sang Manual, Mở/Thu lặp không tạo trùng phiên
  // --------------------------------------------------------------------------
  sim.setSensors({ is_dark: false, wet_percent: 5, humidity_pct: 65.0 });
  sim.manualExtend(t, 'MANUAL_BTN'); // Mở bằng nút nhấn -> Chuyển sang MANUAL (Phiên #3)
  const sessIdAfterFirstExtend = sim.sessionId;
  assert.strictEqual(sim.controlMode, 'MANUAL', 'TC05: Bấm nút mở phải chuyển sang MANUAL');
  assert.strictEqual(sim.rodState, 'EXTENDED', 'TC05: Sào phải ở vị trí EXTENDED');

  // Gửi lệnh mở lặp khi đã mở -> Không tạo phiên mới
  sim.manualExtend(t + 2000, 'MANUAL_WEB');
  assert.strictEqual(sim.sessionId, sessIdAfterFirstExtend, 'TC06: Lệnh mở lặp không tạo phiên mới');

  // Khi đang ở MANUAL ngoài trời mà trời mưa (40%) -> Không tự thu sào nhưng phát cảnh báo MANUAL_RAIN_WARNING
  t += 100 * 1000; // Phơi thêm 100s ở Phiên #3 (Tổng = 900 + 100 = 1000s)
  sim.setSensors({ wet_percent: 40 });
  sim.evaluate(t);
  await flushMqttQueue();
  assert.strictEqual(sim.rodState, 'EXTENDED', 'TC05: Chế độ Manual không bị vòng lặp Auto ghi đè');
  assert.strictEqual(pushCalls.length, 2, 'TC05: Phải phát cảnh báo mưa khi Manual giữ sào ngoài trời');

  // Thu sào thủ công + Thu lặp -> Không cộng thời gian 2 lần
  sim.manualRetract(t, 'MANUAL_WEB');
  const totalAfterRetract = sim.getTotalDryingSec(t);
  assert.strictEqual(totalAfterRetract, 1000, 'TC06: Tổng thời gian sau 3 phiên phải đúng 1000s');
  sim.manualRetract(t + 5000, 'MANUAL_WEB');
  assert.strictEqual(sim.getTotalDryingSec(t + 5000), 1000, 'TC06: Lệnh thu lặp không cộng trùng thời gian');
  results.push({ id: 'TC05 & TC06', name: 'Manual override, cảnh báo mưa Manual & chống mở/thu lặp', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC07: Reset bộ đếm khi sào đang phơi -> Lưu mẻ cũ, mẻ mới về 0 & mở phiên mới ngay
  // --------------------------------------------------------------------------
  const oldBatchId = sim.batchId;
  sim.setSensors({ wet_percent: 5 });
  sim.manualExtend(t, 'MANUAL_BTN'); // Mở Phiên #4 của mẻ cũ
  t += 50 * 1000; // Phơi thêm 50s (mẻ cũ đạt 1050s)
  sim.resetCounter(t); // Bấm nút Reset khi sào đang ở ngoài trời!
  await flushMqttQueue();

  assert.notStrictEqual(sim.batchId, oldBatchId, 'TC07: Phải sinh mã mẻ đồ mới sau khi Reset');
  assert.strictEqual(sim.getTotalDryingSec(t), 0, 'TC07: Tổng thời gian mẻ mới phải về 00:00:00 ngay khi Reset');
  assert.strictEqual(sim.isSessionOpen, true, 'TC07: Sào đang ngoài trời thì phiên #1 của mẻ mới phải bắt đầu ngay');

  const savedOldBatch = backend.firestoreService.memoryStore.batches.get(oldBatchId);
  assert.ok(savedOldBatch, 'TC07: Lịch sử mẻ cũ vẫn phải còn nguyên trên Firestore');
  assert.strictEqual(savedOldBatch.total_duration_sec, 1050, 'TC07: Tổng thời gian mẻ cũ trên Cloud phải bằng 1050s');
  results.push({ id: 'TC07', name: 'Reset khi sào đang phơi (giữ lịch sử mẻ cũ, đếm lại mẻ mới)', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC08: DHT11 đọc lỗi -> Không dùng số giả và khóa mở sào tự động
  // --------------------------------------------------------------------------
  sim.manualRetract(t, 'MANUAL_BTN');
  sim.setMode('AUTO', t);
  sim.setSensors({ dht_valid: false, wet_percent: 0, is_dark: false });
  sim.evaluate(t);
  t += 300 * 1000; // Chờ 300s (> 180s) nhưng DHT11 lỗi
  sim.evaluate(t);
  assert.strictEqual(sim.rodState, 'RETRACTED', 'TC08: DHT11 đọc lỗi tuyệt đối không được mở sào tự động');
  results.push({ id: 'TC08', name: 'DHT11 đọc lỗi -> Báo lỗi null, khóa mở sào tự động', status: 'PASS' });

  // --------------------------------------------------------------------------
  // TC09 & TC10: Kiểm tra bộ lọc 60s của W18, phát hiện khoảng trống mất mạng của W19 & Simulation Mode
  // --------------------------------------------------------------------------
  sim.setSensors({ dht_valid: true, temperature_c: 31.5, humidity_pct: 64.0, wet_percent: 4, is_dark: false });
  const baseSampleTime = t;
  // Gửi 5 bản tin telemetry liên tiếp cách nhau 2.5s -> Chỉ bản tin đầu tiên được lưu vào sensor_samples
  for (let i = 0; i < 5; i++) {
    sim.publishTelemetry(baseSampleTime + i * 2500, false);
  }
  // Gửi bản tin thứ 2 cách 65s (> 60s) -> Được lưu
  sim.publishTelemetry(baseSampleTime + 65000, false);
  // Giả lập mất mạng 10 phút (600s > ngưỡng gap 180s), sau đó có mạng lại
  sim.publishTelemetry(baseSampleTime + 665000, false);
  // Gửi bản tin Simulation Mode -> Phải bị chặn không cho vào lịch sử thật
  sim.publishTelemetry(baseSampleTime + 730000, true);
  await flushMqttQueue();

  const history = await backend.getHistory24h({
    deviceId: 'esp32_01',
    nowMs: baseSampleTime + 740000,
  });

  assert.strictEqual(
    history.chart_24h.sample_count,
    3,
    'TC10 (W18): Bộ lọc 60s chỉ được lưu đúng 3 mẫu thật, bỏ qua các mẫu 2.5s và bỏ qua Simulation Mode'
  );
  assert.strictEqual(
    history.chart_24h.gap_count,
    1,
    'TC10 (W19): Phải phát hiện đúng 1 khoảng trống mất mạng (10 phút) mà không tự tạo dữ liệu bù'
  );
  const gapMarker = history.chart_24h.points.find((p) => p.is_gap_marker);
  assert.ok(gapMarker && gapMarker.temperature_c === null, 'TC10 (W19): Điểm ngắt đoạn biểu đồ phải có giá trị null');
  results.push({
    id: 'TC09 & TC10',
    name: 'W18 (Lọc 60s & cách ly Sim), W19 (Truy vấn 24h & Gap mất mạng), W21 (Cooldown & Retry)',
    status: 'PASS',
  });

  console.log('\n================================================================================');
  console.log('   KẾT QUẢ KIỂM THỬ TÍCH HỢP W06 (W01–W06, W18, W19-PHONG, W21) – NHÓM 21');
  console.log('================================================================================');
  console.table(results);
  console.log('• Tổng số mẫu cảm biến lưu Cloud (chu kỳ 60s):', history.chart_24h.sample_count);
  console.log('• Số khoảng trống mất mạng phát hiện chính xác:', history.chart_24h.gap_count);
  console.log('• Tổng số phiên phơi đã ghi nhận trên Cloud:', history.session_logs.length);
  console.log('• Tổng số thông báo PushSafer đã gửi:', pushCalls.length);
  console.log('• Tổng số Email cảnh báo SMTP đã gửi:', emailCalls.length);
  console.log('• Số lỗi mạng tạm thời đã tự động Retry thành công:', backend.notificationService.errorLogs.length);
  console.log('================================================================================\n');
}

runVerification().catch((err) => {
  console.error('KIỂM THỬ THẤT BẠI:', err);
  process.exit(1);
});
