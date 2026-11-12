#ifndef AERODRY_MQTT_CONTRACT_H
#define AERODRY_MQTT_CONTRACT_H

#include <Arduino.h>
#include "config.h"
#include "types.h"
#include "sensors.h"
#include "drying_tracker.h"
#include "state_machine.h"

// ============================================================================
// MODULE ĐÓNG GÓI BẢN TIN JSON MQTT & HÀNG ĐỢI OFFLINE (W01, W05 - F15, F18, F24)
// Phụ trách: Tạ Bỉnh Phong (24127100)
// Tương thích 100% với cả Giao diện Node-RED Stitch của Triết lẫn Firestore/W18
// ============================================================================

struct QueuedPacket {
  bool is_event; // true: TOPIC_ALERT, false: TOPIC_SESSION
  char payload[768];
};

class AeroDryMqttContract {
private:
  bool         _is_simulation;
  QueuedPacket _offline_queue[OFFLINE_QUEUE_CAPACITY];
  uint8_t      _q_head;
  uint8_t      _q_tail;
  uint8_t      _q_count;

  static void formatFloatOrNull(float val, bool valid, char* buf, size_t len) {
    if (!valid || isnan(val)) {
      snprintf(buf, len, "null");
    } else {
      snprintf(buf, len, "%.1f", val);
    }
  }

  static const char* deriveWeatherType(const SensorSnapshot& s) {
    if (s.wet_percent >= WET_THRESHOLD_HEAVY_PCT) return "MUA_RAO_LON";
    if (s.wet_percent >= WET_THRESHOLD_RETRACT_PCT) return "MUA_BONG_MAY";
    if (s.is_dark || (s.dht_valid && s.humidity_pct >= HUMIDITY_RETRACT_PCT)) return "BAN_DEM";
    return "NANG_RAO";
  }

public:
  AeroDryMqttContract()
    : _is_simulation(false),
      _q_head(0),
      _q_tail(0),
      _q_count(0) {}

  void setSimulationMode(bool sim) { _is_simulation = sim; }
  bool isSimulationMode() const { return _is_simulation; }

  // Lưu bản tin phiên phơi hoặc cảnh báo vào hàng đợi RAM khi mất mạng (F24)
  void enqueueOffline(bool is_event, const char* json_payload) {
    if (_q_count >= OFFLINE_QUEUE_CAPACITY) {
      _q_head = (_q_head + 1) % OFFLINE_QUEUE_CAPACITY;
      _q_count--;
    }
    _offline_queue[_q_tail].is_event = is_event;
    strncpy(_offline_queue[_q_tail].payload, json_payload, sizeof(_offline_queue[_q_tail].payload) - 1);
    _offline_queue[_q_tail].payload[sizeof(_offline_queue[_q_tail].payload) - 1] = '\0';
    _q_tail = (_q_tail + 1) % OFFLINE_QUEUE_CAPACITY;
    _q_count++;
  }

  bool hasQueuedPackets() const { return _q_count > 0; }

  bool dequeueOffline(bool& is_event, char* out_payload, size_t max_len) {
    if (_q_count == 0) return false;
    is_event = _offline_queue[_q_head].is_event;
    strncpy(out_payload, _offline_queue[_q_head].payload, max_len - 1);
    out_payload[max_len - 1] = '\0';
    _q_head = (_q_head + 1) % OFFLINE_QUEUE_CAPACITY;
    _q_count--;
    return true;
  }

  // [W01] Đóng gói JSON Telemetry định kỳ mỗi 2.5s (topic: smartdry/sensor/telemetry)
  // Bao gồm đầy đủ trường phẳng cho UI của Triết và cấu trúc chuẩn cho Firestore W18
  void buildTelemetryJson(uint32_t now_ms,
                          uint32_t now_epoch,
                          bool time_synced,
                          int32_t wifi_rssi,
                          const char* wifi_ip,
                          const SensorSnapshot& s,
                          const AeroDryStateMachine& fsm,
                          const AeroDryDryingTracker& tracker,
                          char* out_json,
                          size_t max_len) const {
    char temp_str[16], hum_str[16], hms_str[16];
    formatFloatOrNull(s.temperature_c, s.dht_valid, temp_str, sizeof(temp_str));
    formatFloatOrNull(s.humidity_pct, s.dht_valid, hum_str, sizeof(hum_str));

    uint32_t total_sec = tracker.getTotalDryingSec(now_ms);
    formatSecondsHMS(total_sec, hms_str, sizeof(hms_str));
    const ActuatorStatus& act = fsm.getActuators();
    const char* weather_type  = deriveWeatherType(s);

    snprintf(out_json, max_len,
      "{"
      "\"schema_ver\":\"%s\","
      "\"group_id\":\"%s\","
      "\"device_id\":\"%s\","
      "\"is_simulation\":%s,"
      "\"timestamp\":%lu,"
      "\"time_synced\":%s,"
      "\"uptime_sec\":%lu,"
      // Các trường tương thích trực tiếp với Giao diện Node-RED / Stitch của Triết:
      "\"dht_valid\":%s,"
      "\"temp\":%s,"
      "\"hum\":%s,"
      "\"rain_pct\":%u,"
      "\"weather_type\":\"%s\","
      "\"ldr_raw\":%u,"
      "\"drying_sec\":%lu,"
      "\"drying_min\":%lu,"
      "\"drying_time_str\":\"%s\","
      "\"is_drying\":%s,"
      "\"fan\":%s,"
      "\"light\":%s,"
      "\"light_mode\":\"%s\","
      "\"mode\":\"%s\","
      "\"rssi\":%ld,"
      "\"ip\":\"%s\","
      "\"rack_state\":%u,"
      // Cấu trúc phân nhóm chi tiết W01 cho lưu trữ Cloud Firestore (W18):
      "\"wifi\":{\"rssi\":%ld,\"ip\":\"%s\"},"
      "\"sensors\":{"
        "\"dht_valid\":%s,"
        "\"temperature_c\":%s,"
        "\"humidity_pct\":%s,"
        "\"rain_adc\":%u,"
        "\"wet_percent\":%u,"
        "\"wet_label\":\"%s\","
        "\"wet_text_vi\":\"%s\","
        "\"ldr_adc\":%u,"
        "\"light_percent\":%u,"
        "\"is_dark\":%s"
      "},"
      "\"actuators\":{"
        "\"control_mode\":\"%s\","
        "\"rod_state\":\"%s\","
        "\"servo_target_deg\":%u,"
        "\"fan_state\":\"%s\","
        "\"light_mode\":\"%s\","
        "\"light_state\":\"%s\""
      "},"
      "\"drying\":{"
        "\"batch_id\":\"%s\","
        "\"session_id\":%lu,"
        "\"is_session_open\":%s,"
        "\"session_start_epoch\":%lu,"
        "\"last_retract_epoch\":%lu,"
        "\"current_session_sec\":%lu,"
        "\"accumulated_sec\":%lu,"
        "\"total_drying_sec\":%lu,"
        "\"formatted_time\":\"%s\","
        "\"dry_confirm_elapsed_sec\":%lu,"
        "\"dry_confirm_target_sec\":%lu,"
        "\"demo_fast_dry\":%s"
      "}"
      "}",
      FIRMWARE_SCHEMA_VER,
      GROUP_ID,
      DEVICE_ID,
      _is_simulation ? "true" : "false",
      (unsigned long)now_epoch,
      time_synced ? "true" : "false",
      (unsigned long)(now_ms / 1000UL),
      // Flat fields:
      s.dht_valid ? "true" : "false",
      temp_str,
      hum_str,
      (unsigned int)s.wet_percent,
      weather_type,
      (unsigned int)s.ldr_adc,
      (unsigned long)total_sec,
      (unsigned long)(total_sec / 60UL),
      hms_str,
      tracker.isSessionOpen() ? "true" : "false",
      act.fan_on ? "true" : "false",
      act.light_on ? "true" : "false",
      controlModeToStr(act.light_mode),
      controlModeToStr(act.control_mode),
      (long)wifi_rssi,
      wifi_ip ? wifi_ip : "0.0.0.0",
      (act.rod_state == ROD_EXTENDED) ? 1U : 0U,
      // Nested W01 objects:
      (long)wifi_rssi,
      wifi_ip ? wifi_ip : "0.0.0.0",
      s.dht_valid ? "true" : "false",
      temp_str,
      hum_str,
      (unsigned int)s.rain_adc,
      (unsigned int)s.wet_percent,
      wetLevelToCode(s.wet_level),
      wetLevelToVi(s.wet_level),
      (unsigned int)s.ldr_adc,
      (unsigned int)s.light_percent,
      s.is_dark ? "true" : "false",
      controlModeToStr(act.control_mode),
      rodStateToStr(act.rod_state),
      (unsigned int)act.servo_target_deg,
      act.fan_on ? "ON" : "OFF",
      controlModeToStr(act.light_mode),
      act.light_on ? "ON" : "OFF",
      tracker.getBatchId(),
      (unsigned long)tracker.getSessionId(),
      tracker.isSessionOpen() ? "true" : "false",
      (unsigned long)tracker.getSessionStartEpoch(),
      (unsigned long)tracker.getLastRetractEpoch(),
      (unsigned long)tracker.getCurrentSessionSec(now_ms),
      (unsigned long)tracker.getAccumulatedSec(),
      (unsigned long)total_sec,
      hms_str,
      (unsigned long)fsm.getDryConfirmElapsedSec(),
      (unsigned long)fsm.getDryConfirmTargetSec(),
      fsm.isDemoFastDry() ? "true" : "false"
    );
  }

  // [W01, W04] Đóng gói JSON Phiên phơi & Mẻ đồ (topic: smartdry/sensor/session)
  void buildSessionJson(const SessionRecord& rec, char* out_json, size_t max_len) const {
    char temp_str[16], hum_str[16], hms_str[16];
    formatFloatOrNull(rec.sensors.temperature_c, rec.sensors.dht_valid, temp_str, sizeof(temp_str));
    formatFloatOrNull(rec.sensors.humidity_pct, rec.sensors.dht_valid, hum_str, sizeof(hum_str));
    formatSecondsHMS(rec.batch_total_drying_sec, hms_str, sizeof(hms_str));

    snprintf(out_json, max_len,
      "{"
      "\"schema_ver\":\"%s\","
      "\"group_id\":\"%s\","
      "\"device_id\":\"%s\","
      "\"is_simulation\":%s,"
      "\"event_type\":\"%s\","
      "\"batch_id\":\"%s\","
      "\"session_id\":%lu,"
      "\"start_epoch\":%lu,"
      "\"end_epoch\":%lu,"
      "\"time_synced\":%s,"
      "\"session_duration_sec\":%lu,"
      "\"batch_total_drying_sec\":%lu,"
      "\"formatted_batch_total\":\"%s\","
      "\"trigger_mode\":\"%s\","
      "\"reason\":\"%s\","
      "\"reason_vi\":\"%s\","
      "\"interrupted\":%s,"
      "\"sensors_snapshot\":{"
        "\"dht_valid\":%s,"
        "\"temperature_c\":%s,"
        "\"humidity_pct\":%s,"
        "\"wet_percent\":%u,"
        "\"is_dark\":%s"
      "}"
      "}",
      FIRMWARE_SCHEMA_VER,
      GROUP_ID,
      DEVICE_ID,
      _is_simulation ? "true" : "false",
      sessionEventTypeToStr(rec.event_type),
      rec.batch_id,
      (unsigned long)rec.session_id,
      (unsigned long)rec.start_epoch,
      (unsigned long)rec.end_epoch,
      rec.time_synced ? "true" : "false",
      (unsigned long)rec.session_duration_sec,
      (unsigned long)rec.batch_total_drying_sec,
      hms_str,
      controlModeToStr(rec.trigger_mode),
      reasonToCode(rec.reason),
      reasonToVi(rec.reason),
      rec.interrupted ? "true" : "false",
      rec.sensors.dht_valid ? "true" : "false",
      temp_str,
      hum_str,
      (unsigned int)rec.sensors.wet_percent,
      rec.sensors.is_dark ? "true" : "false"
    );
  }

  // [W01, W05, W21] Đóng gói JSON Sự kiện & Cảnh báo (topic: smartdry/alert/emergency)
  void buildAlertEventJson(const AlertEventRecord& rec, char* out_json, size_t max_len) const {
    char temp_str[16], hum_str[16], hms_str[16];
    formatFloatOrNull(rec.sensors.temperature_c, rec.sensors.dht_valid, temp_str, sizeof(temp_str));
    formatFloatOrNull(rec.sensors.humidity_pct, rec.sensors.dht_valid, hum_str, sizeof(hum_str));
    formatSecondsHMS(rec.total_drying_sec, hms_str, sizeof(hms_str));

    const char* title_vi = "Sự kiện hệ thống AeroDry";
    char msg_vi[220];
    const char* channels = "[]";

    switch (rec.event_code) {
      case EVT_AUTO_RAIN_RETRACT:
        title_vi = "Cảnh báo mưa - Đã tự động thu sào";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Phát hiện mưa (mức ướt %u%%). Sào đã được thu tự động vào mái che. Thời gian đã phơi của mẻ: %s.",
                 (unsigned int)rec.sensors.wet_percent, hms_str);
        channels = "[\"PUSHSAFER\",\"EMAIL\"]";
        break;
      case EVT_MANUAL_RAIN_WARNING:
        title_vi = "Cảnh báo mưa khi đang ở chế độ Thủ công";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Cảm biến báo ướt (%u%%) nhưng sào đang ở chế độ Manual ngoài trời. Vui lòng kiểm tra và chủ động thu sào!",
                 (unsigned int)rec.sensors.wet_percent);
        channels = "[\"PUSHSAFER\",\"EMAIL\"]";
        break;
      case EVT_HIGH_HUMIDITY_PROLONGED:
        title_vi = "Cảnh báo độ ẩm cao kéo dài";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Độ ẩm môi trường duy trì mức cao (%s%%). Vui lòng kiểm tra đồ phơi và cân nhắc bật quạt hỗ trợ làm khô.",
                 hum_str);
        channels = "[\"EMAIL\"]";
        break;
      case EVT_AUTO_HUMIDITY_RETRACT:
        title_vi = "Thu sào tự động do độ ẩm cao";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Độ ẩm đạt %s%% (>= 85%%). Hệ thống đã tự động thu sào vào mái che.", hum_str);
        break;
      case EVT_AUTO_DARK_RETRACT:
        title_vi = "Thu sào tự động do trời tối";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Trời tối (độ sáng %u%%). Hệ thống đã thu sào vào mái che.", (unsigned int)rec.sensors.light_percent);
        break;
      case EVT_AUTO_DRY_EXTEND:
        title_vi = "Đưa sào ra tự động khi thời tiết khô ráo";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Môi trường đã khô ráo ổn định (mức ướt %u%%, ẩm %s%%). Sào đã được đưa ra tiếp tục phơi.",
                 (unsigned int)rec.sensors.wet_percent, hum_str);
        break;
      case EVT_SENSOR_DHT_ERROR:
        title_vi = "Lỗi đọc cảm biến DHT11";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Không đọc được dữ liệu hợp lệ từ DHT11. Hệ thống tạm khóa mở sào tự động để đảm bảo an toàn.");
        break;
      case EVT_POWER_INTERRUPTED:
        title_vi = "Phát hiện gián đoạn nguồn điện";
        snprintf(msg_vi, sizeof(msg_vi),
                 "Thiết bị vừa khởi động lại sau khi mất điện trong lúc đang phơi. Khoảng thời gian mất điện không được cộng tự động.");
        break;
      default:
        snprintf(msg_vi, sizeof(msg_vi), "Sự kiện hệ thống.");
        break;
    }

    snprintf(out_json, max_len,
      "{"
      "\"schema_ver\":\"%s\","
      "\"event_id\":\"%s\","
      "\"group_id\":\"%s\","
      "\"device_id\":\"%s\","
      "\"is_simulation\":%s,"
      "\"timestamp\":%lu,"
      "\"time_synced\":%s,"
      // Các trường tương thích trực tiếp với Node-RED fn_emergency_alert của Triết:
      "\"type\":\"%s\","
      "\"message\":\"%s\","
      "\"drying_time_str\":\"%s\","
      "\"drying_minutes\":%lu,"
      // Các trường chuẩn W01/W18/W21 của Phong:
      "\"event_code\":\"%s\","
      "\"title_vi\":\"%s\","
      "\"message_vi\":\"%s\","
      "\"batch_id\":\"%s\","
      "\"session_id\":%lu,"
      "\"total_drying_sec\":%lu,"
      "\"formatted_time\":\"%s\","
      "\"rod_state\":\"%s\","
      "\"control_mode\":\"%s\","
      "\"sensors\":{"
        "\"dht_valid\":%s,"
        "\"temperature_c\":%s,"
        "\"humidity_pct\":%s,"
        "\"wet_percent\":%u,"
        "\"is_dark\":%s"
      "},"
      "\"channels\":%s"
      "}",
      FIRMWARE_SCHEMA_VER,
      rec.event_id,
      GROUP_ID,
      DEVICE_ID,
      _is_simulation ? "true" : "false",
      (unsigned long)rec.timestamp,
      rec.time_synced ? "true" : "false",
      alertEventCodeToStr(rec.event_code),
      msg_vi,
      hms_str,
      (unsigned long)(rec.total_drying_sec / 60UL),
      alertEventCodeToStr(rec.event_code),
      title_vi,
      msg_vi,
      rec.batch_id,
      (unsigned long)rec.session_id,
      (unsigned long)rec.total_drying_sec,
      hms_str,
      rodStateToStr(rec.rod_state),
      controlModeToStr(rec.control_mode),
      rec.sensors.dht_valid ? "true" : "false",
      temp_str,
      hum_str,
      (unsigned int)rec.sensors.wet_percent,
      rec.sensors.is_dark ? "true" : "false",
      channels
    );
  }

  // Đóng gói JSON Phản hồi lệnh điều khiển (topic: smartdry/control/ack)
  void buildAckJson(const char* cmd_id,
                    uint32_t now_ms,
                    uint32_t now_epoch,
                    const char* status,
                    const char* reason,
                    const AeroDryStateMachine& fsm,
                    const AeroDryDryingTracker& tracker,
                    char* out_json,
                    size_t max_len) const {
    const ActuatorStatus& act = fsm.getActuators();
    snprintf(out_json, max_len,
      "{"
      "\"cmd_id\":\"%s\","
      "\"device_id\":\"%s\","
      "\"timestamp\":%lu,"
      "\"status\":\"%s\","
      "\"reason\":\"%s\","
      "\"resulting_state\":{"
        "\"control_mode\":\"%s\","
        "\"rod_state\":\"%s\","
        "\"rack_state\":%u,"
        "\"fan_state\":\"%s\","
        "\"light_mode\":\"%s\","
        "\"light_state\":\"%s\","
        "\"batch_id\":\"%s\","
        "\"total_drying_sec\":%lu,"
        "\"demo_fast_dry\":%s"
      "}"
      "}",
      cmd_id ? cmd_id : "CMD_LOCAL",
      DEVICE_ID,
      (unsigned long)now_epoch,
      status,
      reason,
      controlModeToStr(act.control_mode),
      rodStateToStr(act.rod_state),
      (act.rod_state == ROD_EXTENDED) ? 1U : 0U,
      act.fan_on ? "ON" : "OFF",
      controlModeToStr(act.light_mode),
      act.light_on ? "ON" : "OFF",
      tracker.getBatchId(),
      (unsigned long)tracker.getTotalDryingSec(now_ms),
      fsm.isDemoFastDry() ? "true" : "false"
    );
  }
};

#endif // AERODRY_MQTT_CONTRACT_H
