#ifndef AERODRY_TYPES_H
#define AERODRY_TYPES_H

#include <Arduino.h>

// ============================================================================
// 1. CÁC KIỂU LIỆT KÊ (ENUMS) CHO TRẠNG THÁI & SỰ KIỆN
// ============================================================================

// Trạng thái vị trí thanh sào (F04)
enum RodState : uint8_t {
  ROD_RETRACTED = 0, // Thu vào dưới mái hiên (0°)
  ROD_EXTENDED  = 1  // Đưa ra ngoài trời (90°)
};

// Chế độ điều khiển sào hoặc đèn (F06, F13)
enum ControlMode : uint8_t {
  MODE_AUTO   = 0,
  MODE_MANUAL = 1
};

// Phân loại mức ướt cảm biến mưa (F02, Bảng 3.1)
enum WetnessLevel : uint8_t {
  WET_LEVEL_DRY        = 0, // < 15%: Khô
  WET_LEVEL_TRANSITION = 1, // 15% .. <30%: Vùng chuyển tiếp (Đang ướt nhẹ)
  WET_LEVEL_WET        = 2, // 30% .. <50%: Đang ướt
  WET_LEVEL_HEAVY      = 3  // >= 50%: Ướt nhiều
};

// Nguyên nhân thu hoặc mở sào / kết thúc phiên phơi (F07, F09, F20)
enum TransitionReason : uint8_t {
  REASON_NONE            = 0,
  REASON_INIT            = 1,
  REASON_RAIN            = 2, // Thu tự động do mưa (>= 30%)
  REASON_HIGH_HUMIDITY   = 3, // Thu tự động do độ ẩm cao (>= 85%)
  REASON_DARK            = 4, // Thu tự động do trời tối
  REASON_DRY_RECOVERED   = 5, // Mở tự động sau khi xác nhận khô liên tục
  REASON_MANUAL_BTN      = 6, // Người dùng bấm nút vật lý tại chỗ
  REASON_MANUAL_WEB      = 7, // Người dùng điều khiển từ Website
  REASON_BATCH_RESET     = 8, // Đặt lại bộ đếm sang mẻ đồ mới
  REASON_POWER_LOSS      = 9  // Gián đoạn nguồn điện trong lúc đang phơi
};

// Loại bản tin phiên phơi phát lên topic /session (W04, W18)
enum SessionEventType : uint8_t {
  SESSION_EVT_OPENED            = 0,
  SESSION_EVT_CLOSED            = 1,
  SESSION_EVT_BATCH_RESET       = 2,
  SESSION_EVT_INTERRUPTED_POWER = 3
};

// Mã sự kiện cảnh báo phát lên topic /event (W05, W18, W21)
enum AlertEventCode : uint8_t {
  EVT_NONE                    = 0,
  EVT_AUTO_RAIN_RETRACT       = 1, // Thu tự động do mưa -> PushSafer + Email
  EVT_MANUAL_RAIN_WARNING     = 2, // Đang phơi ở Manual mà mưa -> PushSafer + Email
  EVT_HIGH_HUMIDITY_PROLONGED = 3, // Độ ẩm cao kéo dài -> Email nhắc bật quạt
  EVT_AUTO_HUMIDITY_RETRACT   = 4, // Thu tự động do độ ẩm cao -> Nhật ký Cloud
  EVT_AUTO_DARK_RETRACT       = 5, // Thu tự động do trời tối -> Nhật ký Cloud
  EVT_AUTO_DRY_EXTEND         = 6, // Tự đưa sào ra khi khô trở lại -> Nhật ký Cloud
  EVT_SENSOR_DHT_ERROR        = 7, // Cảm biến DHT11 đọc lỗi liên tiếp -> Cảnh báo lỗi dữ liệu
  EVT_POWER_INTERRUPTED       = 8  // Phát hiện mất điện gián đoạn phiên phơi -> Nhật ký Cloud
};

// ============================================================================
// 2. CẤU TRÚC DỮ LIỆU CẢM BIẾN & TRẠNG THÁI (STRUCTS)
// ============================================================================

struct SensorSnapshot {
  bool         dht_valid;
  float        temperature_c;
  float        humidity_pct;
  uint16_t     dht_error_streak;

  uint16_t     rain_adc;
  uint8_t      wet_percent;      // 0..100%
  WetnessLevel wet_level;

  uint16_t     ldr_adc;
  uint8_t      light_percent;    // 0..100%
  bool         is_dark;          // Có ngưỡng trễ (hysteresis)

  uint32_t     last_dht_read_ms;
  uint32_t     last_fast_read_ms;
};

struct ActuatorStatus {
  ControlMode  control_mode;     // AUTO hoặc MANUAL cho sào
  RodState     rod_state;        // RETRACTED (0°) hoặc EXTENDED (90°)
  uint8_t      servo_target_deg; // Góc đích của Servo
  bool         fan_on;           // Quạt DC 5V (luôn tắt trước khi đưa sào ra)
  ControlMode  light_mode;       // AUTO hoặc MANUAL cho đèn LED
  bool         light_on;         // Trạng thái đèn LED hiện tại
};

struct SessionRecord {
  SessionEventType event_type;
  char             batch_id[32];
  uint32_t         session_id;
  uint32_t         start_epoch;
  uint32_t         end_epoch;
  bool             time_synced;
  uint32_t         session_duration_sec;
  uint32_t         batch_total_drying_sec;
  ControlMode      trigger_mode;
  TransitionReason reason;
  bool             interrupted;
  SensorSnapshot   sensors;
};

struct AlertEventRecord {
  char             event_id[40];
  AlertEventCode   event_code;
  uint32_t         timestamp;
  bool             time_synced;
  char             batch_id[32];
  uint32_t         session_id;
  uint32_t         total_drying_sec;
  RodState         rod_state;
  ControlMode      control_mode;
  SensorSnapshot   sensors;
};

// ============================================================================
// 3. HÀM CHUYỂN ĐỔI CHUỖI PHỤC VỤ JSON & LCD
// ============================================================================

inline const char* rodStateToStr(RodState s) {
  return (s == ROD_EXTENDED) ? "EXTENDED" : "RETRACTED";
}

inline const char* controlModeToStr(ControlMode m) {
  return (m == MODE_AUTO) ? "AUTO" : "MANUAL";
}

inline const char* wetLevelToCode(WetnessLevel lvl) {
  switch (lvl) {
    case WET_LEVEL_DRY:        return "DRY";
    case WET_LEVEL_TRANSITION: return "TRANSITION";
    case WET_LEVEL_WET:        return "WET";
    case WET_LEVEL_HEAVY:      return "HEAVY_WET";
    default:                   return "UNKNOWN";
  }
}

// Nhãn tiếng Việt chuẩn theo Mục 3.1 trong Proposal ("Khô", "Đang ướt", "Ướt nhiều")
inline const char* wetLevelToVi(WetnessLevel lvl) {
  switch (lvl) {
    case WET_LEVEL_DRY:        return "Khô";
    case WET_LEVEL_TRANSITION: return "Đang ướt";
    case WET_LEVEL_WET:        return "Đang ướt";
    case WET_LEVEL_HEAVY:      return "Ướt nhiều";
    default:                   return "Không rõ";
  }
}

inline const char* reasonToCode(TransitionReason r) {
  switch (r) {
    case REASON_INIT:          return "INIT";
    case REASON_RAIN:          return "RAIN";
    case REASON_HIGH_HUMIDITY: return "HIGH_HUMIDITY";
    case REASON_DARK:          return "DARK";
    case REASON_DRY_RECOVERED: return "DRY_RECOVERED";
    case REASON_MANUAL_BTN:    return "MANUAL_BTN";
    case REASON_MANUAL_WEB:    return "MANUAL_WEB";
    case REASON_BATCH_RESET:   return "BATCH_RESET";
    case REASON_POWER_LOSS:    return "POWER_LOSS";
    default:                   return "NONE";
  }
}

inline const char* reasonToVi(TransitionReason r) {
  switch (r) {
    case REASON_INIT:          return "Khởi tạo thiết bị";
    case REASON_RAIN:          return "Thu tự động do phát hiện mưa";
    case REASON_HIGH_HUMIDITY: return "Thu tự động do độ ẩm cao (>= 85%)";
    case REASON_DARK:          return "Thu tự động do trời tối";
    case REASON_DRY_RECOVERED: return "Tự động đưa sào ra khi khô ráo trở lại";
    case REASON_MANUAL_BTN:    return "Điều khiển thủ công bằng nút nhấn vật lý";
    case REASON_MANUAL_WEB:    return "Điều khiển thủ công từ Website";
    case REASON_BATCH_RESET:   return "Đặt lại bộ đếm sang mẻ đồ mới";
    case REASON_POWER_LOSS:    return "Gián đoạn do mất nguồn điện";
    default:                   return "Không có";
  }
}

inline const char* sessionEventTypeToStr(SessionEventType t) {
  switch (t) {
    case SESSION_EVT_OPENED:            return "SESSION_OPENED";
    case SESSION_EVT_CLOSED:            return "SESSION_CLOSED";
    case SESSION_EVT_BATCH_RESET:       return "BATCH_RESET";
    case SESSION_EVT_INTERRUPTED_POWER: return "SESSION_INTERRUPTED_POWER";
    default:                            return "UNKNOWN";
  }
}

inline const char* alertEventCodeToStr(AlertEventCode c) {
  switch (c) {
    case EVT_AUTO_RAIN_RETRACT:       return "AUTO_RAIN_RETRACT";
    case EVT_MANUAL_RAIN_WARNING:     return "MANUAL_RAIN_WARNING";
    case EVT_HIGH_HUMIDITY_PROLONGED: return "HIGH_HUMIDITY_PROLONGED";
    case EVT_AUTO_HUMIDITY_RETRACT:   return "AUTO_HUMIDITY_RETRACT";
    case EVT_AUTO_DARK_RETRACT:       return "AUTO_DARK_RETRACT";
    case EVT_AUTO_DRY_EXTEND:         return "AUTO_DRY_EXTEND";
    case EVT_SENSOR_DHT_ERROR:        return "SENSOR_DHT_ERROR";
    case EVT_POWER_INTERRUPTED:       return "POWER_INTERRUPTED";
    default:                          return "NONE";
  }
}

// Định dạng số giây thành chuỗi HH:MM:SS (ví dụ "02:08:11")
inline void formatSecondsHMS(uint32_t total_sec, char* out_buf, size_t buf_size) {
  uint32_t hrs  = total_sec / 3600UL;
  uint32_t mins = (total_sec % 3600UL) / 60UL;
  uint32_t secs = total_sec % 60UL;
  snprintf(out_buf, buf_size, "%02lu:%02lu:%02lu",
           (unsigned long)hrs, (unsigned long)mins, (unsigned long)secs);
}

#endif // AERODRY_TYPES_H
