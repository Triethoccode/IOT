/*
 * ============================================================================
 * ĐỒ ÁN CUỐI KỲ: AERODRY IoT (SMARTBREEZE PRO) – NHÓM 21 – LỚP 24C11
 * Học phần: Vật lý cho Công nghệ Thông tin – PHY00007
 *
 * Firmware tích hợp đầy đủ các gói công việc phần cứng & tự động hóa:
 *  - W01 (Phong): Hợp đồng bản tin MQTT & quy tắc chuyển trạng thái Auto/Manual
 *  - W02 (Phong): Đọc DHT11 (2.5s, cờ lỗi dữ liệu, không gán số giả) & LDR (ngưỡng trễ sáng/tối)
 *  - W03 (Phong): Đọc cảm biến mưa (ADC -> % ướt), thuật toán ngưỡng trễ & chờ khô liên tục (180s / 10s demo)
 *  - W04 (Phong): Bộ đếm thời gian phơi, mẻ đồ (batch), phiên phơi (session), reset & lưu NVS (chống cộng bù mất điện)
 *  - W05 (Phong): Máy trạng thái Auto/Manual, phát sự kiện cảnh báo & điều khiển cục bộ khi mất mạng
 *  - W12 (Linh):  Điều khiển Servo SG90/MG90S (0°/90°) và 3 nút nhấn vật lý chống dội
 *  - W13 (Linh):  Hiển thị LCD1602 I2C luân phiên trang, Relay quạt 5V (tự tắt khi mở sào) & Đèn LED chế độ riêng
 *  - W14 (Linh):  Cổng cấu hình WiFiManager SoftAP (có timeout 120s), Heartbeat & kết nối lại MQTT
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

#include "config.h"
#include "types.h"
#include "sensors.h"
#include "drying_tracker.h"
#include "state_machine.h"
#include "mqtt_contract.h"

// ============================================================================
// 1. KHỞI TẠO CÁC ĐỐI TƯỢNG TOÀN CỤC
// ============================================================================
AeroDrySensors        g_sensors;
AeroDryDryingTracker  g_tracker;
AeroDryStateMachine   g_fsm(g_tracker);
AeroDryMqttContract   g_mqttContract;

WiFiClient            g_wifiClient;
PubSubClient          g_mqtt(g_wifiClient);
Servo                 g_servo;
LiquidCrystal_I2C     g_lcd(LCD_I2C_ADDR, 16, 2);

const char*           g_mqtt_broker = MQTT_BROKER_DEFAULT;
uint16_t              g_mqtt_port   = MQTT_PORT_DEFAULT;

// Bộ định thời non-blocking
uint32_t              g_last_telemetry_ms  = 0;
uint32_t              g_last_heartbeat_ms  = 0;
uint32_t              g_last_mqtt_retry_ms = 0;
uint32_t              g_last_lcd_ms        = 0;
uint8_t               g_lcd_page           = 0;

// Biến chống dội 3 nút nhấn vật lý (F05 - W12)
struct ButtonDebounce {
  uint8_t  pin;
  bool     last_reading;
  bool     stable_state;
  uint32_t last_change_ms;
};

ButtonDebounce g_btnExtend  = { PIN_BTN_EXTEND,  HIGH, HIGH, 0 };
ButtonDebounce g_btnRetract = { PIN_BTN_RETRACT, HIGH, HIGH, 0 };
ButtonDebounce g_btnReset   = { PIN_BTN_RESET,   HIGH, HIGH, 0 };

// ============================================================================
// 2. HÀM TIỆN ÍCH THỜI GIAN NTP (F09: Đánh dấu đồng bộ giờ mạng)
// ============================================================================
uint32_t getCurrentEpoch(bool& out_synced) {
  time_t now;
  time(&now);
  if (now > 1700000000L) {
    out_synced = true;
    return (uint32_t)now;
  }
  out_synced = false;
  return (uint32_t)(millis() / 1000UL);
}

// ============================================================================
// 3. CALLBACK ĐIỀU KHIỂN PHẦN CỨNG TẠI CHỖ (W12, W13)
// ============================================================================
void onHardwareActuatorChange(const ActuatorStatus& act) {
  // 1. Điều khiển góc Servo (0° dưới mái che, 90° ngoài trời)
  g_servo.write(act.servo_target_deg);

  // 2. Điều khiển Relay quạt DC 5V (tự động tắt trước khi đưa sào ra)
  digitalWrite(PIN_RELAY_FAN, act.fan_on ? RELAY_ACTIVE_LEVEL : RELAY_INACTIVE_LEVEL);

  // 3. Điều khiển Đèn LED chiếu sáng
  digitalWrite(PIN_LED_LIGHT, act.light_on ? HIGH : LOW);
}

// ============================================================================
// 4. CALLBACK PHÁT BẢN TIN PHIÊN PHƠI (W04) & SỰ KIỆN CẢNH BÁO (W05)
// ============================================================================
void onSessionEventGenerated(const SessionRecord& rec) {
  char json_buf[768];
  g_mqttContract.buildSessionJson(rec, json_buf, sizeof(json_buf));

  if (g_mqtt.connected()) {
    g_mqtt.publish(TOPIC_SESSION, json_buf, false);
  } else {
    // Khi mất mạng, lưu vào hàng đợi RAM để gửi bù khi có mạng lại (F24)
    g_mqttContract.enqueueOffline(false, json_buf);
  }
  Serial.printf("[W04-SESSION] %s\n", json_buf);
}

void onAlertEventGenerated(const AlertEventRecord& evt) {
  char json_buf[768];
  g_mqttContract.buildAlertEventJson(evt, json_buf, sizeof(json_buf));

  if (g_mqtt.connected()) {
    g_mqtt.publish(TOPIC_ALERT, json_buf, false);
  } else {
    // Khi mất mạng, lưu sự kiện cảnh báo vào hàng đợi RAM (F24)
    g_mqttContract.enqueueOffline(true, json_buf);
  }
  Serial.printf("[W05-ALERT] %s\n", json_buf);
}

// ============================================================================
// 5. NHẬN LỆNH ĐIỀU KHIỂN TỪ WEBSITE QUA MQTT (F18, F24)
// Hỗ trợ đầy đủ cả smartdry/control/rack & smartdry/control/dryer của Node-RED
// ============================================================================
bool extractJsonString(const char* json, const char* key, char* out_val, size_t max_len) {
  char pattern[48];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(json, pattern);
  if (!p) return false;
  p = strchr(p + strlen(pattern), ':');
  if (!p) return false;
  p = strchr(p, '\"');
  if (!p) return false;
  p++;
  const char* end = strchr(p, '\"');
  if (!end) return false;
  size_t len = (size_t)(end - p);
  if (len >= max_len) len = max_len - 1;
  memcpy(out_val, p, len);
  out_val[len] = '\0';
  return true;
}

bool extractJsonUint(const char* json, const char* key, uint32_t& out_val) {
  char pattern[48];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(json, pattern);
  if (!p) return false;
  p = strchr(p + strlen(pattern), ':');
  if (!p) return false;
  p++;
  while (*p == ' ' || *p == '\t') p++;
  if (*p < '0' || *p > '9') return false;
  out_val = (uint32_t)strtoul(p, nullptr, 10);
  return true;
}

bool extractJsonBool(const char* json, const char* key, bool& out_val) {
  char pattern[48];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* p = strstr(json, pattern);
  if (!p) return false;
  p = strchr(p + strlen(pattern), ':');
  if (!p) return false;
  p++;
  while (*p == ' ' || *p == '\t') p++;
  if (strncmp(p, "true", 4) == 0) {
    out_val = true;
    return true;
  }
  if (strncmp(p, "false", 5) == 0) {
    out_val = false;
    return true;
  }
  return false;
}

void onMqttMessageReceived(char* topic, byte* payload, unsigned int length) {
  char msg[512];
  size_t copy_len = (length < sizeof(msg) - 1) ? length : (sizeof(msg) - 1);
  memcpy(msg, payload, copy_len);
  msg[copy_len] = '\0';

  uint32_t now_ms = millis();
  bool time_synced = false;
  uint32_t now_epoch = getCurrentEpoch(time_synced);

  char cmd_id[48] = "CMD_WEB";
  extractJsonString(msg, "cmd_id", cmd_id, sizeof(cmd_id));

  // Mục 3.6 & 3.10: Kiểm tra hạn hiệu lực (TTL) của lệnh để không tự chạy lại lệnh cũ
  uint32_t issued_at = 0;
  uint32_t ttl_sec   = CMD_MAX_TTL_SEC;
  extractJsonUint(msg, "issued_at", issued_at);
  extractJsonUint(msg, "ttl_sec", ttl_sec);

  if (time_synced && issued_at > 1700000000UL && now_epoch > issued_at + ttl_sec) {
    char ack_json[384];
    g_mqttContract.buildAckJson(cmd_id, now_ms, now_epoch, "EXPIRED", "COMMAND_TTL_EXPIRED",
                                g_fsm, g_tracker, ack_json, sizeof(ack_json));
    g_mqtt.publish(TOPIC_CTRL_ACK, ack_json, false);
    return;
  }

  const char* status = "ACCEPTED";
  const char* reason = "OK";
  const SensorSnapshot& s = g_sensors.getSnapshot();

  // 1. Nhánh điều khiển sào, chế độ Auto/Manual & Reset bộ đếm (smartdry/control/rack)
  if (strcmp(topic, TOPIC_CTRL_RACK) == 0) {
    char mode_str[24] = "";
    if (extractJsonString(msg, "mode", mode_str, sizeof(mode_str))) {
      if (strcmp(mode_str, "AUTO") == 0) {
        g_fsm.commandSetControlMode(MODE_AUTO, now_ms, now_epoch, time_synced, g_sensors);
      } else if (strcmp(mode_str, "MANUAL") == 0) {
        g_fsm.commandSetControlMode(MODE_MANUAL, now_ms, now_epoch, time_synced, g_sensors);
      }
    }

    char action[32] = "";
    if (extractJsonString(msg, "action", action, sizeof(action))) {
      if (strcmp(action, "EXTEND") == 0) {
        // Thao tác mở trực tiếp tự động chuyển sang Manual (Mục 3.2)
        g_fsm.commandExtendRod(now_ms, now_epoch, time_synced, REASON_MANUAL_WEB, s);
      } else if (strcmp(action, "RETRACT") == 0) {
        // Thao tác thu trực tiếp tự động chuyển sang Manual (Mục 3.2)
        g_fsm.commandRetractRod(now_ms, now_epoch, time_synced, REASON_MANUAL_WEB, s);
      } else if (strcmp(action, "RESET_TIMER") == 0 || strcmp(action, "RESET_COUNTER") == 0) {
        // Đặt lại bộ đếm sang mẻ đồ mới (Mục 3.4)
        g_fsm.commandResetCounter(now_ms, now_epoch, time_synced, s);
      }
    }

    bool fast_dry = false;
    if (extractJsonBool(msg, "demo_fast_dry", fast_dry)) {
      g_fsm.setDemoFastDry(fast_dry);
    }
  }
  // 2. Nhánh điều khiển Quạt sấy gió & Đèn ban công (smartdry/control/dryer)
  else if (strcmp(topic, TOPIC_CTRL_DRY) == 0) {
    bool fan_val = false;
    if (extractJsonBool(msg, "fan", fan_val)) {
      if (!g_fsm.commandSetFan(fan_val)) {
        status = "REJECTED";
        reason = "CANNOT_TURN_ON_FAN_WHILE_ROD_EXTENDED";
      }
    }

    bool light_val = false;
    char lmode_str[16] = "";
    bool has_light = extractJsonBool(msg, "light", light_val);
    bool has_lmode = extractJsonString(msg, "light_mode", lmode_str, sizeof(lmode_str));
    if (has_light || has_lmode) {
      ControlMode lmode = (has_lmode && strcmp(lmode_str, "AUTO") == 0) ? MODE_AUTO : MODE_MANUAL;
      g_fsm.commandSetLight(lmode, light_val, s);
    }
  }

  // Gửi bản tin ACK phản hồi mã lệnh về Node-RED / Website (F18)
  char ack_json[384];
  g_mqttContract.buildAckJson(cmd_id, now_ms, now_epoch, status, reason,
                              g_fsm, g_tracker, ack_json, sizeof(ack_json));
  g_mqtt.publish(TOPIC_CTRL_ACK, ack_json, false);
}

// ============================================================================
// 6. ĐỌC 3 NÚT NHẤN VẬT LÝ CHỐNG DỘI KHÔNG CHẶN (F05, F10 - W12)
// ============================================================================
bool isButtonPressedEdge(ButtonDebounce& btn, uint32_t now_ms) {
  bool reading = digitalRead(btn.pin);
  if (reading != btn.last_reading) {
    btn.last_change_ms = now_ms;
    btn.last_reading   = reading;
  }
  if ((now_ms - btn.last_change_ms) >= BTN_DEBOUNCE_MS) {
    if (reading != btn.stable_state) {
      btn.stable_state = reading;
      if (btn.stable_state == LOW) {
        return true;
      }
    }
  }
  return false;
}

void pollPhysicalButtons(uint32_t now_ms, uint32_t now_epoch, bool time_synced) {
  const SensorSnapshot& s = g_sensors.getSnapshot();

  // Nút 1: Đưa sào ra -> Chuyển sang Manual và mở sào
  if (isButtonPressedEdge(g_btnExtend, now_ms)) {
    g_fsm.commandExtendRod(now_ms, now_epoch, time_synced, REASON_MANUAL_BTN, s);
  }

  // Nút 2: Thu sào vào -> Chuyển sang Manual và thu sào
  if (isButtonPressedEdge(g_btnRetract, now_ms)) {
    g_fsm.commandRetractRod(now_ms, now_epoch, time_synced, REASON_MANUAL_BTN, s);
  }

  // Nút 3: Đặt lại bộ đếm thời gian phơi sang mẻ đồ mới
  if (isButtonPressedEdge(g_btnReset, now_ms)) {
    g_fsm.commandResetCounter(now_ms, now_epoch, time_synced, s);
  }
}

// ============================================================================
// 7. HIỂN THỊ TẠI CHỖ TRÊN LCD1602 I2C (F11 - W13)
// ============================================================================
void updateLocalLcd(uint32_t now_ms) {
  if (now_ms - g_last_lcd_ms < LCD_PAGE_SWITCH_MS) return;
  g_last_lcd_ms = now_ms;
  g_lcd_page    = (g_lcd_page + 1) % 2;

  const SensorSnapshot& s   = g_sensors.getSnapshot();
  const ActuatorStatus& act = g_fsm.getActuators();
  char line1[17], line2[17];

  if (g_lcd_page == 0) {
    if (s.dht_valid) {
      snprintf(line1, sizeof(line1), "T:%4.1fC H:%4.1f%%", s.temperature_c, s.humidity_pct);
    } else {
      snprintf(line1, sizeof(line1), "DHT11: LOI DU LIEU");
    }
    snprintf(line2, sizeof(line2), "Uot:%3u%% %-7s",
             (unsigned int)s.wet_percent,
             (s.wet_level == WET_LEVEL_DRY) ? "KHO" :
             (s.wet_level == WET_LEVEL_HEAVY) ? "UOTNHIEU" : "DANGUOT");
  } else {
    snprintf(line1, sizeof(line1), "%-4s Sao:%-7s",
             (act.control_mode == MODE_AUTO) ? "AUTO" : "MANU",
             (act.rod_state == ROD_EXTENDED) ? "PHOI" : "THU");
    char hms[12];
    formatSecondsHMS(g_tracker.getTotalDryingSec(now_ms), hms, sizeof(hms));
    snprintf(line2, sizeof(line2), "Phoi: %s  ", hms);
  }

  g_lcd.setCursor(0, 0);
  g_lcd.print(line1);
  g_lcd.setCursor(0, 1);
  g_lcd.print(line2);
}

// ============================================================================
// 8. DUY TRÌ KẾT NỐI MQTT KHÔNG CHẶN & XẢ HÀNG ĐỢI OFFLINE (F15, F24 - W14)
// ============================================================================
void maintainNetworkAndPublish(uint32_t now_ms, uint32_t now_epoch, bool time_synced) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!g_mqtt.connected()) {
      if (now_ms - g_last_mqtt_retry_ms >= 5000UL) {
        g_last_mqtt_retry_ms = now_ms;
        String client_id = String("AeroDry-") + DEVICE_ID + "-" + String(random(1000, 9999));
        const char* lwt_payload = "{\"device_id\":\"" DEVICE_ID "\",\"status\":\"OFFLINE\"}";

        if (g_mqtt.connect(client_id.c_str(), MQTT_USER_DEFAULT, MQTT_PASS_DEFAULT,
                           TOPIC_HEARTBEAT, 0, true, lwt_payload)) {
          g_mqtt.subscribe(TOPIC_CTRL_RACK, 0);
          g_mqtt.subscribe(TOPIC_CTRL_DRY, 0);
        }
      }
    } else {
      g_mqtt.loop();

      // Xả các bản tin phiên phơi / cảnh báo được lưu tạm trong lúc mất mạng
      while (g_mqttContract.hasQueuedPackets()) {
        bool is_evt = false;
        char queued_json[768];
        if (g_mqttContract.dequeueOffline(is_evt, queued_json, sizeof(queued_json))) {
          g_mqtt.publish(is_evt ? TOPIC_ALERT : TOPIC_SESSION, queued_json, false);
        }
      }

      // Gửi Telemetry mỗi 2.5 giây hoặc ngay khi trạng thái cơ cấu thay đổi
      if ((now_ms - g_last_telemetry_ms >= TELEMETRY_INTERVAL_MS) || g_fsm.consumeStateDirty()) {
        g_last_telemetry_ms = now_ms;
        char tele_json[1152];
        String ip_str = WiFi.localIP().toString();
        g_mqttContract.buildTelemetryJson(now_ms, now_epoch, time_synced,
                                          WiFi.RSSI(), ip_str.c_str(),
                                          g_sensors.getSnapshot(), g_fsm, g_tracker,
                                          tele_json, sizeof(tele_json));
        g_mqtt.publish(TOPIC_TELEMETRY, tele_json, false);
      }

      // Gửi Heartbeat mỗi 10 giây (F15)
      if (now_ms - g_last_heartbeat_ms >= HEARTBEAT_INTERVAL_MS) {
        g_last_heartbeat_ms = now_ms;
        char hb_json[256];
        String ip_str = WiFi.localIP().toString();
        snprintf(hb_json, sizeof(hb_json),
                 "{\"group_id\":\"%s\",\"device_id\":\"%s\",\"status\":\"ONLINE\","
                 "\"rssi\":%ld,\"ip\":\"%s\",\"uptime_sec\":%lu,\"timestamp\":%lu}",
                 GROUP_ID, DEVICE_ID, (long)WiFi.RSSI(), ip_str.c_str(),
                 (unsigned long)(now_ms / 1000UL), (unsigned long)now_epoch);
        g_mqtt.publish(TOPIC_HEARTBEAT, hb_json, true);
      }
    }
  }
}

// ============================================================================
// 9. SETUP & LOOP CHÍNH CỦA ESP32
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== KHOI DONG HE THONG AERODRY IoT - NHOM 21 ===");

  pinMode(PIN_RELAY_FAN, OUTPUT);
  digitalWrite(PIN_RELAY_FAN, RELAY_INACTIVE_LEVEL); // Quạt mặc định tắt khi khởi động (Mục 3.5)

  pinMode(PIN_LED_LIGHT, OUTPUT);
  digitalWrite(PIN_LED_LIGHT, LOW);

  pinMode(PIN_BTN_EXTEND, INPUT_PULLUP);
  pinMode(PIN_BTN_RETRACT, INPUT_PULLUP);
  pinMode(PIN_BTN_RESET, INPUT_PULLUP);

  g_servo.setPeriodHertz(50);
  g_servo.attach(PIN_SERVO, 500, 2400);
  g_servo.write(SERVO_ANGLE_RETRACTED);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  g_lcd.init();
  g_lcd.backlight();
  g_lcd.setCursor(0, 0);
  g_lcd.print("AeroDry IoT G21 ");
  g_lcd.setCursor(0, 1);
  g_lcd.print("WiFi Portal...  ");

  // Khởi tạo cảm biến (W02, W03)
  g_sensors.begin();
  g_sensors.update(millis());

  // Đăng ký callbacks cho Bộ đếm (W04) và Máy trạng thái (W05)
  g_tracker.setSessionCallback(onSessionEventGenerated);
  g_fsm.setAlertCallback(onAlertEventGenerated);
  g_fsm.setHardwareCallback(onHardwareActuatorChange);

  // [W14 - F14] Cổng cấu hình Wi-Fi bằng SoftAP có thời gian chờ 120s (không chặn vô hạn)
  WiFiManager wm;
  wm.setConfigPortalTimeout(WIFI_PORTAL_TIMEOUT_SEC);
  wm.autoConnect("AeroDry_Config_AP");

  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  g_mqtt.setServer(g_mqtt_broker, g_mqtt_port);
  g_mqtt.setBufferSize(1280);
  g_mqtt.setCallback(onMqttMessageReceived);

  bool time_synced = false;
  uint32_t boot_epoch = getCurrentEpoch(time_synced);

  // Khôi phục bộ đếm từ NVS & kiểm tra gián đoạn nguồn điện (W04)
  g_tracker.begin(boot_epoch, time_synced, g_sensors.getSnapshot());
  g_fsm.begin();
  g_lcd.clear();
}

void loop() {
  uint32_t now_ms = millis();
  bool time_synced = false;
  uint32_t now_epoch = getCurrentEpoch(time_synced);

  // 1. Đọc cảm biến (DHT11 mỗi 2.5s, Mưa & LDR mỗi 250ms) - W02, W03
  g_sensors.update(now_ms);

  // 2. Xử lý nút nhấn vật lý tại chỗ (hoạt động ngay cả khi mất mạng) - F05, F24
  pollPhysicalButtons(now_ms, now_epoch, time_synced);

  // 3. Chạy máy trạng thái Auto/Manual, đếm xác nhận khô & phát sự kiện cảnh báo - W03, W05
  g_fsm.evaluate(now_ms, now_epoch, time_synced, g_sensors);

  // 4. Cập nhật màn hình LCD1602 tại chỗ - F11
  updateLocalLcd(now_ms);

  // 5. Đồng bộ MQTT & xả hàng đợi khi có mạng - W01, W05
  maintainNetworkAndPublish(now_ms, now_epoch, time_synced);
}
