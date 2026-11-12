#ifndef AERODRY_CONFIG_H
#define AERODRY_CONFIG_H

#include <Arduino.h>

// ============================================================================
// 1. THÔNG TIN ĐỒ ÁN & THIẾT BỊ (W01)
// ============================================================================
#define GROUP_ID                    "G21_24C11"
#define DEVICE_ID                   "esp32_01"
#define FIRMWARE_SCHEMA_VER         "1.0"

// ============================================================================
// 2. CẤU HÌNH CHÂN GPIO ESP32 (Khớp 100% với sơ đồ phần cứng của nhóm)
// Lưu ý: Cảm biến mưa và LDR dùng ADC1 (GPIO 34, 35) để không xung đột với Wi-Fi
// ============================================================================
#define PIN_DHT11                   4     // Digital input đọc DHT11
#define PIN_RAIN_ADC                34    // ADC1_CH6 đọc module cảm biến mưa (AO)
#define PIN_LDR_ADC                 35    // ADC1_CH7 đọc module quang trở LDR (AO)

#define PIN_SERVO                   25    // PWM điều khiển Servo SG90/MG90S
#define PIN_RELAY_FAN               16    // Ngõ điều khiển Relay quạt DC 5V
#define PIN_LED_LIGHT               5     // Ngõ điều khiển đèn LED trắng dưới mái hiên

// Ba nút nhấn vật lý (INPUT_PULLUP, nhấn mức LOW)
#define PIN_BTN_EXTEND              15    // Nút 1: Đưa sào ra (chuyển sang Manual)
#define PIN_BTN_RETRACT             2     // Nút 2: Thu sào vào (chuyển sang Manual)
#define PIN_BTN_RESET               33    // Nút 3: Đặt lại bộ đếm thời gian phơi (Reset mẻ mới)

// I2C cho màn hình LCD1602 (Mặc định ESP32: SDA = 21, SCL = 22)
#define PIN_I2C_SDA                 21
#define PIN_I2C_SCL                 22
#define LCD_I2C_ADDR                0x27

// Cấu hình mức kích Relay quạt (Module Relay 1 kênh thông dụng kích mức LOW)
#define RELAY_ACTIVE_LEVEL          LOW
#define RELAY_INACTIVE_LEVEL        HIGH

// Góc danh định của Servo (hiệu chỉnh theo cơ cấu thực tế tránh ép điểm chặn)
#define SERVO_ANGLE_RETRACTED       0     // 0 độ: Dưới mái hiên
#define SERVO_ANGLE_EXTENDED        90    // 90 độ: Ngoài trời

// ============================================================================
// 3. CHU KỲ ĐỌC CẢM BIẾN & ĐỒNG BỘ (W02, W03, W05, W14)
// ============================================================================
#define WIFI_PORTAL_TIMEOUT_SEC     120UL     // Giới hạn 120s chờ WiFiManager để không treo vô hạn (Mục 3.9)
#define DHT_READ_INTERVAL_MS        2500UL    // Đọc DHT11 mỗi 2.5 giây (Mục 3.1)
#define FAST_SENSOR_INTERVAL_MS     250UL     // Đọc mưa & LDR mỗi 250ms để phản ứng mưa nhanh
#define TELEMETRY_INTERVAL_MS       2500UL    // Gửi telemetry lên MQTT mỗi 2.5 giây
#define HEARTBEAT_INTERVAL_MS       10000UL   // Gửi heartbeat mỗi 10 giây
#define LCD_PAGE_SWITCH_MS          3000UL    // Luân phiên trang hiển thị LCD1602 mỗi 3 giây
#define BTN_DEBOUNCE_MS             50UL      // Chống dội nút nhấn vật lý 50ms

// ============================================================================
// 4. NGƯỠNG CẢM BIẾN & THUẬT TOÁN NGƯỠNG TRỄ - HYSTERESIS (Bảng 3.1 - W02, W03)
// ============================================================================

// --- 4.1. Hiệu chỉnh ADC Cảm biến mưa (12-bit: 0..4095) ---
// Tấm cảm biến mưa: Khô hoàn toàn ADC cao (~4095), Ướt hoàn toàn ADC thấp (~500..1200)
#define RAIN_ADC_DRY_DEFAULT        4095
#define RAIN_ADC_WET_DEFAULT        500

// Các ngưỡng phần trăm mức ướt (Bảng 3.1):
#define WET_THRESHOLD_RETRACT_PCT   30    // >= 30%: Phát hiện ướt -> Thu sào & phát cảnh báo
#define WET_THRESHOLD_HEAVY_PCT     50    // >= 50%: Ướt nhiều -> Giữ sào trong mái che, không lặp cảnh báo
#define WET_THRESHOLD_DRY_MAX_PCT   15    // < 15%: Điều kiện mức ướt để được tính là Khô trở lại
// Vùng chuyển tiếp mức ướt: 15% <= wet_percent < 30% -> Giữ trạng thái hiện có, không đếm chờ khô

// --- 4.2. Ngưỡng Độ ẩm không khí DHT11 (Bảng 3.1) ---
#define HUMIDITY_RETRACT_PCT        85.0f // >= 85%: Độ ẩm cao -> Thu sào
#define HUMIDITY_DRY_MAX_PCT        82.0f // < 82%: Điều kiện độ ẩm để được tính là Khô trở lại
// Vùng chuyển tiếp độ ẩm: 82% <= humidity < 85% -> Giữ trạng thái hiện có, không đếm chờ khô

// --- 4.3. Hiệu chỉnh ADC Cảm biến ánh sáng LDR & Khoảng trễ sáng/tối ---
// Khi trời tối LDR raw > 2600 (tương ứng độ sáng <= 25%) -> Chuyển sang TRỜI TỐI
// Khi đang tối, LDR raw phải giảm xuống < 2200 (độ sáng >= 35%) -> Mới chuyển sang TRỜI SÁNG
#define LDR_DARK_HIGHER_ADC         true
#define LDR_ADC_MIN                 100
#define LDR_ADC_MAX                 3900
#define LIGHT_DARK_ENTER_PCT        25
#define LIGHT_BRIGHT_EXIT_PCT       35

// --- 4.4. Thời gian xác nhận khô liên tục trước khi mở lại (F08, W03) ---
#define DRY_CONFIRM_STANDARD_SEC    180UL // Chuẩn theo đề xuất: 180 giây liên tục
#define DRY_CONFIRM_DEMO_SEC        10UL  // Khi demo: có thể rút còn 10 giây

// --- 4.5. Thời gian cảnh báo và chống gửi trùng tại ESP32 (W05) ---
#define MANUAL_RAIN_WARN_COOLDOWN_MS    300000UL  // 5 phút giữa 2 lần cảnh báo mưa khi đang ở Manual
#define HIGH_HUMIDITY_PROLONGED_MS      900000UL  // 15 phút độ ẩm >= 85% liên tục -> Phát sự kiện nhắc bật quạt
#define HIGH_HUMIDITY_WARN_COOLDOWN_MS  1800000UL // 30 phút cooldown cảnh báo ẩm cao kéo dài
#define DHT_ERROR_ALERT_COUNT           5         // Lỗi liên tiếp 5 chu kỳ (12.5s) -> Phát sự kiện lỗi cảm biến

// ============================================================================
// 5. CẤU HÌNH MQTT TOPICS (Khớp với Node-RED Dashboard của Triết & W01)
// ============================================================================
#define MQTT_BROKER_DEFAULT         "broker.hivemq.com"
#define MQTT_PORT_DEFAULT           1883
#define MQTT_USER_DEFAULT           ""
#define MQTT_PASS_DEFAULT           ""

// Topics chính tương thích trực tiếp với flows.json trên Node-RED của nhóm:
#define TOPIC_TELEMETRY             "smartdry/sensor/telemetry"
#define TOPIC_SESSION               "smartdry/sensor/session"
#define TOPIC_HEARTBEAT             "smartdry/sensor/heartbeat"
#define TOPIC_ALERT                 "smartdry/alert/emergency"
#define TOPIC_CTRL_RACK             "smartdry/control/rack"
#define TOPIC_CTRL_DRY              "smartdry/control/dryer"
#define TOPIC_CTRL_ACK              "smartdry/control/ack"

#define TOPIC_PREFIX_REAL           "smartdry"
#define TOPIC_PREFIX_SIM            "smartdry/sim"

#define CMD_MAX_TTL_SEC             30UL  // Bỏ qua lệnh cũ quá 30s (khi đồng bộ NTP)
#define OFFLINE_QUEUE_CAPACITY      16    // Số bản tin phiên phơi/sự kiện lưu tạm trong RAM khi mất mạng

#endif // AERODRY_CONFIG_H
