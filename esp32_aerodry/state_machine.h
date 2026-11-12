#ifndef AERODRY_STATE_MACHINE_H
#define AERODRY_STATE_MACHINE_H

#include <Arduino.h>
#include "config.h"
#include "types.h"
#include "sensors.h"
#include "drying_tracker.h"

// ============================================================================
// MODULE MÁY TRẠNG THÁI AUTO/MANUAL, CẢNH BÁO & ĐIỀU KHIỂN CỤC BỘ (W03, W05)
// Phụ trách: Tạ Bỉnh Phong (24127100)
// ============================================================================

typedef void (*AlertEventCallback)(const AlertEventRecord& evt);
typedef void (*HardwareActuatorCallback)(const ActuatorStatus& act);

class AeroDryStateMachine {
private:
  AeroDryDryingTracker&    _tracker;
  ActuatorStatus           _act;

  // Bộ đếm xác nhận khô liên tục (F08, W03)
  bool                     _demo_fast_dry;
  uint32_t                 _dry_confirm_target_sec;
  bool                     _dry_confirm_active;
  uint32_t                 _dry_confirm_start_ms;
  uint32_t                 _dry_confirm_elapsed_sec;

  // Chống gửi lặp cảnh báo mưa trong cùng đợt mưa (Mục 3.3 & 3.8)
  bool                     _auto_rain_alert_latched;
  bool                     _manual_rain_warn_latched;
  uint32_t                 _last_manual_rain_warn_ms;

  // Theo dõi độ ẩm cao kéo dài (Mục 3.8 - F22)
  bool                     _high_hum_tracking;
  uint32_t                 _high_hum_start_ms;
  uint32_t                 _high_hum_target_ms;
  uint32_t                 _last_high_hum_alert_ms;
  bool                     _high_hum_alert_sent_in_streak;

  uint32_t                 _event_seq;
  AlertEventCallback       _on_alert;
  HardwareActuatorCallback _on_actuator_change;
  bool                     _state_dirty; // Báo hiệu có thay đổi trạng thái cần publish /state

  void applyHardware() {
    _state_dirty = true;
    if (_on_actuator_change) {
      _on_actuator_change(_act);
    }
  }

  void emitAlert(AlertEventCode code,
                 uint32_t now_ms,
                 uint32_t now_epoch,
                 bool time_synced,
                 const SensorSnapshot& sensors) {
    if (!_on_alert) return;
    _event_seq++;
    AlertEventRecord rec;
    memset(&rec, 0, sizeof(rec));
    snprintf(rec.event_id, sizeof(rec.event_id), "EVT_%s_%lu_%lu",
             DEVICE_ID, (unsigned long)now_ms, (unsigned long)_event_seq);
    rec.event_code       = code;
    rec.timestamp        = now_epoch;
    rec.time_synced      = time_synced;
    strncpy(rec.batch_id, _tracker.getBatchId(), sizeof(rec.batch_id) - 1);
    rec.session_id       = _tracker.getSessionId();
    rec.total_drying_sec = _tracker.getTotalDryingSec(now_ms);
    rec.rod_state        = _act.rod_state;
    rec.control_mode     = _act.control_mode;
    rec.sensors          = sensors;
    _on_alert(rec);
  }

  // Đưa sào ra ngoài trời (luôn tắt quạt trước khi đưa sào ra theo Mục 3.5)
  bool extendRodInternal(uint32_t now_ms,
                         uint32_t now_epoch,
                         bool time_synced,
                         TransitionReason reason,
                         const SensorSnapshot& sensors) {
    // Mục 3.4: Lệnh mở lặp khi đã mở không tạo phiên mới
    if (_act.rod_state == ROD_EXTENDED) {
      return false;
    }

    // Mục 3.5: "Trước khi đưa sào ra, chương trình tắt quạt để thống nhất vận hành khu vực mái che."
    _act.fan_on           = false;
    _act.rod_state        = ROD_EXTENDED;
    _act.servo_target_deg = SERVO_ANGLE_EXTENDED;

    // Đặt lại bộ đếm chờ khô và mở khóa cảnh báo mưa cho phiên mới
    resetDryConfirmTimer();
    _auto_rain_alert_latched  = false;
    _manual_rain_warn_latched = false;

    _tracker.startSession(now_ms, now_epoch, time_synced, _act.control_mode, reason, sensors);
    applyHardware();
    return true;
  }

  // Thu sào vào dưới mái hiên và kết thúc phiên phơi hiện tại
  bool retractRodInternal(uint32_t now_ms,
                          uint32_t now_epoch,
                          bool time_synced,
                          TransitionReason reason,
                          const SensorSnapshot& sensors) {
    resetDryConfirmTimer();

    // Mục 3.4: Lệnh thu lặp khi đã thu không cộng thời gian lần nữa
    if (_act.rod_state == ROD_RETRACTED) {
      return false;
    }

    _act.rod_state        = ROD_RETRACTED;
    _act.servo_target_deg = SERVO_ANGLE_RETRACTED;

    _tracker.stopSession(now_ms, now_epoch, time_synced, _act.control_mode, reason, sensors);
    applyHardware();
    return true;
  }

  void resetDryConfirmTimer() {
    _dry_confirm_active      = false;
    _dry_confirm_start_ms    = 0;
    _dry_confirm_elapsed_sec = 0;
  }

public:
  explicit AeroDryStateMachine(AeroDryDryingTracker& tracker)
    : _tracker(tracker),
      _demo_fast_dry(false),
      _dry_confirm_target_sec(DRY_CONFIRM_STANDARD_SEC),
      _dry_confirm_active(false),
      _dry_confirm_start_ms(0),
      _dry_confirm_elapsed_sec(0),
      _auto_rain_alert_latched(false),
      _manual_rain_warn_latched(false),
      _last_manual_rain_warn_ms(0),
      _high_hum_tracking(false),
      _high_hum_start_ms(0),
      _high_hum_target_ms(HIGH_HUMIDITY_PROLONGED_MS),
      _last_high_hum_alert_ms(0),
      _high_hum_alert_sent_in_streak(false),
      _event_seq(0),
      _on_alert(nullptr),
      _on_actuator_change(nullptr),
      _state_dirty(false) {
    // Trạng thái khởi động an toàn: Auto, sào thu trong mái hiên, quạt tắt, đèn Auto
    _act.control_mode     = MODE_AUTO;
    _act.rod_state        = ROD_RETRACTED;
    _act.servo_target_deg = SERVO_ANGLE_RETRACTED;
    _act.fan_on           = false;
    _act.light_mode       = MODE_AUTO;
    _act.light_on         = false;
  }

  void setAlertCallback(AlertEventCallback cb) { _on_alert = cb; }
  void setHardwareCallback(HardwareActuatorCallback cb) { _on_actuator_change = cb; }

  void begin() {
    applyHardware();
  }

  // Cấu hình thời gian chờ khô (180s chuẩn hoặc 10s khi demo - Mục 3.3)
  void setDemoFastDry(bool enabled) {
    _demo_fast_dry          = enabled;
    _dry_confirm_target_sec = enabled ? DRY_CONFIRM_DEMO_SEC : DRY_CONFIRM_STANDARD_SEC;
    resetDryConfirmTimer();
    _state_dirty = true;
  }

  // Cho phép tùy chỉnh thời gian theo dõi độ ẩm cao kéo dài (phục vụ kiểm thử W06 / demo)
  void setHighHumidityProlongedTargetMs(uint32_t target_ms) {
    _high_hum_target_ms = target_ms;
  }

  // ==========================================================================
  // VÒNG LẶP ĐÁNH GIÁ MÁY TRẠNG THÁI CỤC BỘ (Chạy độc lập kể cả khi mất mạng)
  // ==========================================================================
  void evaluate(uint32_t now_ms,
                uint32_t now_epoch,
                bool time_synced,
                AeroDrySensors& sensorModule) {
    const SensorSnapshot& s = sensorModule.getSnapshot();

    // 0. Kiểm tra sự kiện mất điện lúc khởi động (nếu có)
    if (_tracker.consumePowerInterruptedFlag()) {
      emitAlert(EVT_POWER_INTERRUPTED, now_ms, now_epoch, time_synced, s);
    }

    // 1. Kiểm tra lỗi cảm biến DHT11 (Mục 3.1 & 3.10)
    if (sensorModule.consumeDhtErrorAlert()) {
      emitAlert(EVT_SENSOR_DHT_ERROR, now_ms, now_epoch, time_synced, s);
    }

    // 2. Điều khiển đèn LED khi đèn ở chế độ Tự động (F13 - Mục 3.5)
    // Ở Thủ công, đèn giữ theo lệnh web đến khi người dùng chọn lại Tự động
    if (_act.light_mode == MODE_AUTO) {
      if (_act.light_on != s.is_dark) {
        _act.light_on = s.is_dark;
        applyHardware();
      }
    }

    // 3. Theo dõi độ ẩm cao kéo dài (>= 85% liên tục -> gửi email nhắc bật quạt, Mục 3.8)
    if (s.dht_valid && s.humidity_pct >= HUMIDITY_RETRACT_PCT) {
      if (!_high_hum_tracking) {
        _high_hum_tracking             = true;
        _high_hum_start_ms             = now_ms;
        _high_hum_alert_sent_in_streak = false;
      } else {
        uint32_t hum_elapsed = now_ms - _high_hum_start_ms;
        bool cooldown_ok = (_last_high_hum_alert_ms == 0) ||
                           (now_ms - _last_high_hum_alert_ms >= HIGH_HUMIDITY_WARN_COOLDOWN_MS);
        if (hum_elapsed >= _high_hum_target_ms && !_high_hum_alert_sent_in_streak && cooldown_ok) {
          _high_hum_alert_sent_in_streak = true;
          _last_high_hum_alert_ms        = now_ms;
          emitAlert(EVT_HIGH_HUMIDITY_PROLONGED, now_ms, now_epoch, time_synced, s);
        }
      }
    } else if (s.dht_valid && s.humidity_pct < HUMIDITY_DRY_MAX_PCT) {
      _high_hum_tracking             = false;
      _high_hum_alert_sent_in_streak = false;
    }

    // 4. Xử lý theo chế độ điều khiển sào (AUTO vs MANUAL)
    if (_act.control_mode == MODE_MANUAL) {
      resetDryConfirmTimer();

      // Mục 3.2: "Khi Manual vẫn giữ sào ngoài trời trong lúc cảm biến báo ướt,
      // hệ thống cảnh báo để người dùng nhận biết và chủ động thu."
      if (_act.rod_state == ROD_EXTENDED && s.wet_percent >= WET_THRESHOLD_RETRACT_PCT) {
        bool cooldown_ok = (_last_manual_rain_warn_ms == 0) ||
                           (now_ms - _last_manual_rain_warn_ms >= MANUAL_RAIN_WARN_COOLDOWN_MS);
        if (!_manual_rain_warn_latched && cooldown_ok) {
          _manual_rain_warn_latched = true;
          _last_manual_rain_warn_ms = now_ms;
          emitAlert(EVT_MANUAL_RAIN_WARNING, now_ms, now_epoch, time_synced, s);
        }
      } else if (s.wet_percent < WET_THRESHOLD_DRY_MAX_PCT) {
        _manual_rain_warn_latched = false;
      }
      return; // Ở chế độ Manual, vòng lặp tự động tuyệt đối không ghi đè lệnh thủ công
    }

    // ========================================================================
    // 5. CHẾ ĐỘ AUTO – TRÌNH TỰ XỬ LÝ THEO BẢNG 3.1 (Mục 3.3 - W03, W05)
    // ========================================================================

    // 5.1. Ưu tiên cao nhất: Phát hiện ướt (wet_percent >= 30%) hoặc Ướt nhiều (>= 50%)
    if (s.wet_percent >= WET_THRESHOLD_RETRACT_PCT) {
      resetDryConfirmTimer();
      if (_act.rod_state == ROD_EXTENDED) {
        // Đang phơi mà gặp mưa -> Thu sào, đóng phiên và phát sự kiện cảnh báo 1 lần
        retractRodInternal(now_ms, now_epoch, time_synced, REASON_RAIN, s);
        if (!_auto_rain_alert_latched) {
          _auto_rain_alert_latched = true;
          emitAlert(EVT_AUTO_RAIN_RETRACT, now_ms, now_epoch, time_synced, s);
        }
      }
      // Nếu đã thu (hoặc ướt nhiều >= 50%), giữ sào trong mái che và KHÔNG phát lặp cảnh báo
      return;
    }

    // 5.2. Độ ẩm cao (humidity >= 85%)
    if (s.dht_valid && s.humidity_pct >= HUMIDITY_RETRACT_PCT) {
      resetDryConfirmTimer();
      if (_act.rod_state == ROD_EXTENDED) {
        retractRodInternal(now_ms, now_epoch, time_synced, REASON_HIGH_HUMIDITY, s);
        emitAlert(EVT_AUTO_HUMIDITY_RETRACT, now_ms, now_epoch, time_synced, s);
      }
      return;
    }

    // 5.3. Trời tối (is_dark == true)
    if (s.is_dark) {
      resetDryConfirmTimer();
      if (_act.rod_state == ROD_EXTENDED) {
        retractRodInternal(now_ms, now_epoch, time_synced, REASON_DARK, s);
        emitAlert(EVT_AUTO_DARK_RETRACT, now_ms, now_epoch, time_synced, s);
      }
      return;
    }

    // 5.4. Kiểm tra điều kiện Khô trở lại (Bảng 3.1):
    // Phải thỏa ĐỒNG THỜI:
    //  (a) Dữ liệu DHT11 hợp lệ (Mục 3.3: "Khi dữ liệu cần cho mở tự động không hợp lệ, hệ thống chưa cho mở lại")
    //  (b) Mức ướt dưới 15% (wet_percent < 15)
    //  (c) Trời sáng (!is_dark)
    //  (d) Độ ẩm dưới 82% (humidity_pct < 82.0)
    bool all_dry_conditions_met = s.dht_valid &&
                                  (s.wet_percent < WET_THRESHOLD_DRY_MAX_PCT) &&
                                  (!s.is_dark) &&
                                  (s.humidity_pct < HUMIDITY_DRY_MAX_PCT);

    if (!all_dry_conditions_met) {
      // Đang ở vùng chuyển tiếp (15% <= wet < 30% hoặc 82% <= hum < 85%) hoặc DHT11 lỗi:
      // Giữ trạng thái hiện có và đặt bộ đếm chờ mở lại về 0 (Bảng 3.1)
      resetDryConfirmTimer();
      return;
    }

    // Khi đã khô hoàn toàn (< 15%), xóa chốt cảnh báo mưa để sẵn sàng cho đợt mưa sau
    _auto_rain_alert_latched = false;

    // Nếu sào đang thu trong mái che (ROD_RETRACTED), đếm thời gian xác nhận khô liên tục
    if (_act.rod_state == ROD_RETRACTED) {
      if (!_dry_confirm_active) {
        _dry_confirm_active      = true;
        _dry_confirm_start_ms    = now_ms;
        _dry_confirm_elapsed_sec = 0;
      } else {
        uint32_t elapsed_ms      = now_ms - _dry_confirm_start_ms;
        _dry_confirm_elapsed_sec = elapsed_ms / 1000UL;

        if (elapsed_ms >= (_dry_confirm_target_sec * 1000UL)) {
          // Đã thỏa điều kiện khô liên tục đủ thời gian xác nhận -> Mở sào tự động!
          extendRodInternal(now_ms, now_epoch, time_synced, REASON_DRY_RECOVERED, s);
          emitAlert(EVT_AUTO_DRY_EXTEND, now_ms, now_epoch, time_synced, s);
        }
      }
    } else {
      resetDryConfirmTimer();
    }
  }

  // ==========================================================================
  // CÁC THAO TÁC ĐIỀU KHIỂN TỪ NÚT NHẤN VẬT LÝ & WEBSITE (F05, F06, F10, F12, F13, F18)
  // ==========================================================================

  // Thao tác đưa sào ra trực tiếp (từ nút nhấn hoặc web) -> Tự động chuyển sang MANUAL (Mục 3.2)
  bool commandExtendRod(uint32_t now_ms,
                        uint32_t now_epoch,
                        bool time_synced,
                        TransitionReason source_reason,
                        const SensorSnapshot& sensors) {
    bool mode_changed = (_act.control_mode != MODE_MANUAL);
    _act.control_mode = MODE_MANUAL;
    resetDryConfirmTimer();

    bool rod_moved = extendRodInternal(now_ms, now_epoch, time_synced, source_reason, sensors);
    if (mode_changed && !rod_moved) {
      applyHardware();
    }
    return rod_moved || mode_changed;
  }

  // Thao tác thu sào trực tiếp (từ nút nhấn hoặc web) -> Tự động chuyển sang MANUAL (Mục 3.2)
  bool commandRetractRod(uint32_t now_ms,
                         uint32_t now_epoch,
                         bool time_synced,
                         TransitionReason source_reason,
                         const SensorSnapshot& sensors) {
    bool mode_changed = (_act.control_mode != MODE_MANUAL);
    _act.control_mode = MODE_MANUAL;
    resetDryConfirmTimer();

    bool rod_moved = retractRodInternal(now_ms, now_epoch, time_synced, source_reason, sensors);
    if (mode_changed && !rod_moved) {
      applyHardware();
    }
    return rod_moved || mode_changed;
  }

  // Chuyển chế độ Auto / Manual rõ ràng từ Website (F06 - Mục 3.2)
  void commandSetControlMode(ControlMode new_mode,
                             uint32_t now_ms,
                             uint32_t now_epoch,
                             bool time_synced,
                             AeroDrySensors& sensorModule) {
    if (_act.control_mode == new_mode) return;
    _act.control_mode = new_mode;
    resetDryConfirmTimer();
    applyHardware();

    // Nếu chuyển về AUTO, đánh giá ngay điều kiện thời tiết hiện tại
    if (new_mode == MODE_AUTO) {
      evaluate(now_ms, now_epoch, time_synced, sensorModule);
    }
  }

  // Điều khiển quạt hỗ trợ làm khô (F12 - Mục 3.5)
  bool commandSetFan(bool turn_on) {
    // Nếu sào đang ở ngoài trời, không bật quạt dưới mái hiên (đồng nhất quy tắc Mục 3.5)
    if (turn_on && _act.rod_state == ROD_EXTENDED) {
      return false;
    }
    if (_act.fan_on != turn_on) {
      _act.fan_on = turn_on;
      applyHardware();
    }
    return true;
  }

  // Điều khiển đèn chiếu sáng và chế độ đèn (F13 - Mục 3.5)
  void commandSetLight(ControlMode mode, bool manual_state, const SensorSnapshot& sensors) {
    _act.light_mode = mode;
    if (mode == MODE_MANUAL) {
      _act.light_on = manual_state;
    } else {
      _act.light_on = sensors.is_dark;
    }
    applyHardware();
  }

  // Đặt lại bộ đếm thời gian phơi sang mẻ đồ mới (F10 - Mục 3.4)
  void commandResetCounter(uint32_t now_ms,
                           uint32_t now_epoch,
                           bool time_synced,
                           const SensorSnapshot& sensors) {
    _tracker.resetBatch(now_ms, now_epoch, time_synced, _act.rod_state, _act.control_mode, sensors);
    _state_dirty = true;
  }

  bool consumeStateDirty() {
    if (_state_dirty) {
      _state_dirty = false;
      return true;
    }
    return false;
  }

  const ActuatorStatus& getActuators() const { return _act; }
  uint32_t getDryConfirmElapsedSec() const { return _dry_confirm_elapsed_sec; }
  uint32_t getDryConfirmTargetSec() const { return _dry_confirm_target_sec; }
  bool isDemoFastDry() const { return _demo_fast_dry; }
};

#endif // AERODRY_STATE_MACHINE_H
