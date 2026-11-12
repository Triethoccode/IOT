#ifndef AERODRY_DRYING_TRACKER_H
#define AERODRY_DRYING_TRACKER_H

#include <Arduino.h>
#include <Preferences.h>
#include "config.h"
#include "types.h"

// ============================================================================
// MODULE BỘ ĐẾM THỜI GIAN PHƠI, MẺ ĐỒ, PHIÊN PHƠI & LƯU NVS (W04 - F09, F10, F24)
// Phụ trách: Tạ Bỉnh Phong (24127100)
// ============================================================================

typedef void (*SessionEventCallback)(const SessionRecord& rec);

class AeroDryDryingTracker {
private:
  Preferences          _prefs;
  bool                 _prefs_ready;

  uint32_t             _batch_seq;          // Số thứ tự mẻ đồ tăng dần trong NVS
  char                 _batch_id[32];       // Mã mẻ đồ hiện tại (VD: "BATCH_00012")
  uint32_t             _session_id;         // Số thứ tự phiên phơi trong mẻ hiện tại
  bool                 _is_session_open;    // Phiên phơi đang mở (sào đang ở ngoài trời)
  uint32_t             _session_start_ms;   // Mốc millis() bắt đầu phiên (độc lập thay đổi giờ mạng)
  uint32_t             _session_start_epoch;// Mốc Unix timestamp bắt đầu phiên (nếu có NTP)
  uint32_t             _last_retract_epoch; // Mốc Unix timestamp lần thu sào gần nhất
  bool                 _session_time_synced;// Cờ đã đồng bộ giờ mạng khi mở phiên
  uint32_t             _accumulated_sec;    // Tổng số giây của các phiên đã đóng trong mẻ hiện tại
  bool                 _power_interrupted_on_boot;

  SessionEventCallback _on_session_event;

  void buildBatchId(uint32_t seq, uint32_t epoch) {
    if (epoch > 1700000000UL) {
      snprintf(_batch_id, sizeof(_batch_id), "BATCH_%lu_%lu",
               (unsigned long)epoch, (unsigned long)seq);
    } else {
      snprintf(_batch_id, sizeof(_batch_id), "BATCH_LOCAL_%05lu",
               (unsigned long)seq);
    }
  }

  void persistToNVS() {
    if (!_prefs_ready) return;
    _prefs.putUInt("batch_seq", _batch_seq);
    _prefs.putString("batch_id", _batch_id);
    _prefs.putUInt("session_id", _session_id);
    _prefs.putBool("sess_open", _is_session_open);
    _prefs.putUInt("start_epoch", _session_start_epoch);
    _prefs.putUInt("retr_epoch", _last_retract_epoch);
    _prefs.putUInt("accum_sec", _accumulated_sec);
  }

  void emitRecord(SessionEventType evt_type,
                  uint32_t start_ep,
                  uint32_t end_ep,
                  bool time_synced,
                  uint32_t sess_dur_sec,
                  uint32_t total_sec,
                  ControlMode mode,
                  TransitionReason reason,
                  bool interrupted,
                  const SensorSnapshot& sensors) {
    if (!_on_session_event) return;
    SessionRecord rec;
    memset(&rec, 0, sizeof(rec));
    rec.event_type             = evt_type;
    strncpy(rec.batch_id, _batch_id, sizeof(rec.batch_id) - 1);
    rec.session_id             = _session_id;
    rec.start_epoch            = start_ep;
    rec.end_epoch              = end_ep;
    rec.time_synced            = time_synced;
    rec.session_duration_sec   = sess_dur_sec;
    rec.batch_total_drying_sec = total_sec;
    rec.trigger_mode           = mode;
    rec.reason                 = reason;
    rec.interrupted            = interrupted;
    rec.sensors                = sensors;
    _on_session_event(rec);
  }

public:
  AeroDryDryingTracker()
    : _prefs_ready(false),
      _batch_seq(1),
      _session_id(0),
      _is_session_open(false),
      _session_start_ms(0),
      _session_start_epoch(0),
      _last_retract_epoch(0),
      _session_time_synced(false),
      _accumulated_sec(0),
      _power_interrupted_on_boot(false),
      _on_session_event(nullptr) {
    snprintf(_batch_id, sizeof(_batch_id), "BATCH_LOCAL_00001");
  }

  void setSessionCallback(SessionEventCallback cb) {
    _on_session_event = cb;
  }

  // Khởi tạo và khôi phục trạng thái mẻ đồ từ NVS sau khi khởi động / mất điện (F09, F24)
  void begin(uint32_t boot_epoch, bool time_synced, const SensorSnapshot& boot_sensors) {
    _prefs_ready = _prefs.begin("aerodry_w04", false);
    if (!_prefs_ready) {
      buildBatchId(_batch_seq, boot_epoch);
      return;
    }

    _batch_seq          = _prefs.getUInt("batch_seq", 1);
    String saved_batch  = _prefs.getString("batch_id", "");
    _session_id         = _prefs.getUInt("session_id", 0);
    bool was_open       = _prefs.getBool("sess_open", false);
    uint32_t prev_start = _prefs.getUInt("start_epoch", 0);
    _last_retract_epoch = _prefs.getUInt("retr_epoch", 0);
    _accumulated_sec    = _prefs.getUInt("accum_sec", 0);

    if (saved_batch.length() > 0) {
      strncpy(_batch_id, saved_batch.c_str(), sizeof(_batch_id) - 1);
      _batch_id[sizeof(_batch_id) - 1] = '\0';
    } else {
      buildBatchId(_batch_seq, boot_epoch);
      _prefs.putString("batch_id", _batch_id);
    }

    // Mục 3.4 & 3.10: Nếu trước khi mất điện phiên đang mở (was_open == true),
    // đánh dấu gián đoạn nguồn điện và KHÔNG tự cộng khoảng thời gian mất điện vào tổng thời gian phơi.
    if (was_open) {
      _is_session_open           = false;
      _power_interrupted_on_boot = true;
      persistToNVS();

      emitRecord(SESSION_EVT_INTERRUPTED_POWER,
                 prev_start,
                 boot_epoch,
                 time_synced,
                 0, // Không tự cộng thời gian mất điện không xác định
                 _accumulated_sec,
                 MODE_AUTO,
                 REASON_POWER_LOSS,
                 true,
                 boot_sensors);
    }
  }

  bool consumePowerInterruptedFlag() {
    if (_power_interrupted_on_boot) {
      _power_interrupted_on_boot = false;
      return true;
    }
    return false;
  }

  // [W04] Ghi nhận mốc bắt đầu phiên phơi khi đưa sào ra (EXTENDED)
  // Lệnh mở lặp khi đã mở không tạo phiên mới (Mục 3.4)
  bool startSession(uint32_t now_ms,
                    uint32_t now_epoch,
                    bool time_synced,
                    ControlMode mode,
                    TransitionReason reason,
                    const SensorSnapshot& sensors) {
    if (_is_session_open) {
      return false; // Đã mở rồi -> bỏ qua để tránh tạo phiên trùng
    }

    _session_id++;
    _is_session_open     = true;
    _session_start_ms    = now_ms;
    _session_start_epoch = now_epoch;
    _session_time_synced = time_synced;
    persistToNVS();

    emitRecord(SESSION_EVT_OPENED,
               _session_start_epoch,
               0,
               time_synced,
               0,
               _accumulated_sec,
               mode,
               reason,
               false,
               sensors);
    return true;
  }

  // [W04] Kết thúc phiên phơi khi thu sào vào (RETRACTED) và cộng dồn vào mẻ đồ
  // Lệnh thu lặp khi đã thu không cộng thời gian lần nữa (Mục 3.4)
  bool stopSession(uint32_t now_ms,
                   uint32_t now_epoch,
                   bool time_synced,
                   ControlMode mode,
                   TransitionReason reason,
                   const SensorSnapshot& sensors) {
    if (!_is_session_open) {
      return false; // Đã đóng rồi -> không cộng trùng thời gian
    }

    // Tính thời lượng bằng đồng hồ hoạt động nội bộ millis() tại ESP32 (Mục 3.4)
    uint32_t elapsed_sec = (now_ms - _session_start_ms) / 1000UL;
    _accumulated_sec    += elapsed_sec;
    _is_session_open     = false;
    _last_retract_epoch  = now_epoch;
    persistToNVS();

    emitRecord(SESSION_EVT_CLOSED,
               _session_start_epoch,
               now_epoch,
               time_synced && _session_time_synced,
               elapsed_sec,
               _accumulated_sec,
               mode,
               reason,
               false,
               sensors);
    return true;
  }

  // [W04 - F10] Đặt lại bộ đếm (Reset tạo mẻ đồ mới, đặt tổng về 00:00:00)
  // Mục 3.4: "Nếu sào đang ngoài trời thì phiên mới bắt đầu ngay sau reset. Nhật ký của mẻ cũ vẫn được lưu trên cloud."
  void resetBatch(uint32_t now_ms,
                  uint32_t now_epoch,
                  bool time_synced,
                  RodState current_rod_state,
                  ControlMode current_mode,
                  const SensorSnapshot& sensors) {
    // 1. Nếu đang có phiên mở của mẻ cũ, đóng phiên đó lại để lưu trọn vẹn lịch sử mẻ cũ
    if (_is_session_open) {
      stopSession(now_ms, now_epoch, time_synced, current_mode, REASON_BATCH_RESET, sensors);
    }

    // 2. Phát bản tin tổng kết đóng mẻ cũ trước khi chuyển sang mẻ mới
    emitRecord(SESSION_EVT_BATCH_RESET,
               _session_start_epoch,
               now_epoch,
               time_synced,
               0,
               _accumulated_sec,
               current_mode,
               REASON_BATCH_RESET,
               false,
               sensors);

    // 3. Khởi tạo mẻ đồ mới với tổng thời gian = 00:00:00
    _batch_seq++;
    buildBatchId(_batch_seq, now_epoch);
    _session_id          = 0;
    _accumulated_sec     = 0;
    _is_session_open     = false;
    _session_start_ms    = now_ms;
    _session_start_epoch = 0;
    persistToNVS();

    // 4. Nếu sào đang ở ngoài trời (ROD_EXTENDED), bắt đầu ngay phiên #1 của mẻ mới
    if (current_rod_state == ROD_EXTENDED) {
      startSession(now_ms, now_epoch, time_synced, current_mode, REASON_BATCH_RESET, sensors);
    }
  }

  // Thời lượng của phiên đang mở hiện tại (giây)
  uint32_t getCurrentSessionSec(uint32_t now_ms) const {
    if (!_is_session_open) return 0;
    return (now_ms - _session_start_ms) / 1000UL;
  }

  // Tổng thời gian đã cộng dồn của các phiên đã đóng (giây)
  uint32_t getAccumulatedSec() const {
    return _accumulated_sec;
  }

  // Tổng thời gian phơi của mẻ đồ hiện tại = các phiên đã kết thúc + phiên đang mở (Mục 3.4)
  uint32_t getTotalDryingSec(uint32_t now_ms) const {
    return _accumulated_sec + getCurrentSessionSec(now_ms);
  }

  const char* getBatchId() const { return _batch_id; }
  uint32_t getSessionId() const { return _session_id; }
  bool isSessionOpen() const { return _is_session_open; }
  uint32_t getSessionStartEpoch() const { return _session_start_epoch; }
  uint32_t getLastRetractEpoch() const { return _last_retract_epoch; }
};

#endif // AERODRY_DRYING_TRACKER_H
