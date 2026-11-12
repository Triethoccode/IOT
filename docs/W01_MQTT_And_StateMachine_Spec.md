# W01 – Đặc Tả Kỹ Thuật: Quy Tắc Auto/Manual, Bộ Đếm Phiên Phơi & Hợp Đồng Bản Tin MQTT

**Dự án:** AeroDry IoT (SmartBreeze Pro) – Nhóm 21 – Lớp 24C11  
**Phụ trách W01:** Tạ Bỉnh Phong (24127100)  
**Phạm vi áp dụng:** Đồng bộ giao thức giữa ESP32 (Phong & Linh), Node-RED / Website (Triết) và Cloud Firestore / Cảnh báo (Phong).

---

## 1. Quy Tắc Máy Trạng Thái Sào Phơi & Chế Độ Auto/Manual (F04–F08, F12–F13, F24)

### 1.1. Các trạng thái danh định
- **Vị trí sào (`rod_state`):**
  - `RETRACTED`: Thu vào dưới mái hiên (góc danh định `0°`, hiệu chỉnh thực tế qua `SERVO_ANGLE_RETRACTED`).
  - `EXTENDED`: Đưa ra vị trí phơi ngoài trời (góc danh định `90°`, hiệu chỉnh thực tế qua `SERVO_ANGLE_EXTENDED`).
- **Chế độ điều khiển sào (`control_mode`):**
  - `AUTO`: ESP32 tự động quyết định thu/mở sào theo dữ liệu cảm biến (Bảng 3.1).
  - `MANUAL`: Người dùng chủ động điều khiển qua nút nhấn vật lý hoặc website; vòng lặp tự động **không** ghi đè lệnh thủ công.
- **Chế độ đèn (`light_mode`):**
  - `AUTO`: Tự động bật khi trời tối (`is_dark == true`) và tắt khi trời sáng (`is_dark == false`) với ngưỡng trễ.
  - `MANUAL`: Giữ nguyên trạng thái bật/tắt theo lệnh từ website cho đến khi người dùng chuyển lại `AUTO`.
- **Quạt hỗ trợ làm khô (`fan_state`):**
  - Mặc định `OFF` khi khởi động.
  - Điều khiển bật/tắt thủ công từ website khi sào ở dưới mái che.
  - **Quy tắc an toàn vận hành:** Trước khi đưa sào ra ngoài trời (`RETRACTED -> EXTENDED`), hệ thống **tự động tắt quạt (`fan_state = OFF`)**.

### 1.2. Quy tắc chuyển đổi giữa Auto và Manual
1. Khi đang ở `AUTO`, nếu có **thao tác thu hoặc mở trực tiếp** từ:
   - Nút nhấn vật lý tại thiết bị (`BTN_EXTEND` hoặc `BTN_RETRACT`), hoặc
   - Lệnh thu/mở trực tiếp từ website (`CMD_EXTEND_ROD`, `CMD_RETRACT_ROD`),
   thì hệ thống **tự động chuyển `control_mode` sang `MANUAL`**, thực thi lệnh và đồng bộ trạng thái mới lên website.
2. Khi đang ở `MANUAL`:
   - Vòng lặp tự động theo thời tiết không tự ý thu hoặc mở sào.
   - **Cảnh báo mưa khi ở Manual:** Nếu sào đang ở ngoài trời (`rod_state == EXTENDED`) và cảm biến phát hiện ướt (`wet_percent >= 30%`), ESP32 phát sự kiện cảnh báo `MANUAL_RAIN_WARNING` (có thời gian chờ chống lặp) để nhắc người dùng chủ động thu sào.
3. Để quay lại `AUTO`, cần thao tác chọn chế độ rõ ràng (`CMD_SET_MODE` với `mode: "AUTO"`).

---

## 2. Thuật Toán Thời Tiết, Ngưỡng Trễ (Hysteresis) & Chờ Khô (W02, W03)

### 2.1. Bảng ngưỡng cảm biến và quy tắc điều khiển tự động (Chế độ `AUTO`)

| Tình huống | Điều kiện cảm biến | Hành động ở chế độ `AUTO` |
| :--- | :--- | :--- |
| **Phát hiện ướt** (`WET`) | `wet_percent >= 30%` | Thu sào ngay (`RETRACTED`), đóng phiên phơi (`reason: "RAIN"`), đặt lại bộ đếm chờ khô = 0. Nếu trước đó đang phơi (`EXTENDED`), phát sự kiện cảnh báo `AUTO_RAIN_RETRACT`. |
| **Ướt nhiều / kéo dài** (`HEAVY_WET`) | `wet_percent >= 50%` hoặc tiếp tục duy trì `>= 30%` | Giữ sào trong mái che (`RETRACTED`); **không** phát lặp thông báo ở mọi chu kỳ đọc. |
| **Độ ẩm cao** (`HIGH_HUMIDITY`) | `dht_valid == true` và `humidity >= 85.0%` | Thu sào (`RETRACTED`), đóng phiên phơi (`reason: "HIGH_HUMIDITY"`), đặt bộ đếm chờ khô = 0. |
| **Trời tối** (`DARK`) | `ldr_raw` vượt ngưỡng tối (`is_dark == true`) | Thu sào (`RETRACTED`), đóng phiên phơi (`reason: "DARK"`), đặt bộ đếm chờ khô = 0. Bật đèn nếu `light_mode == AUTO`. |
| **Vùng chuyển tiếp** (`TRANSITION`) | `15% <= wet_percent < 30%` hoặc `82.0% <= humidity < 85.0%` | Giữ nguyên trạng thái sào hiện có; đặt bộ đếm chờ khô = 0 (chưa bắt đầu đếm mở lại). |
| **Khô trở lại** (`DRY_RECOVERY`) | Đồng thời thỏa **4 điều kiện**:<br>1. `dht_valid == true`<br>2. `wet_percent < 15%`<br>3. `is_dark == false` (trời sáng)<br>4. `humidity < 82.0%`<br>liên tục trong thời gian xác nhận `dry_confirm_target_sec` | Khi `dry_confirm_elapsed_sec >= dry_confirm_target_sec` và sào đang `RETRACTED`: tự động tắt quạt, đưa sào ra (`EXTENDED`) và bắt đầu phiên phơi mới. |

### 2.2. Hiệu chỉnh và chống dao động (Hysteresis)
- **Cảm biến mưa (ADC 12-bit: 0–4095):**
  - Hiệu chỉnh theo hai mốc `RAIN_ADC_DRY` (mặc định `3800`) và `RAIN_ADC_WET` (mặc định `1200`):
    $$\text{wet\_percent} = \text{clamp}\left(\frac{\text{RAIN\_ADC\_DRY} - \text{adc}}{\text{RAIN\_ADC\_DRY} - \text{RAIN\_ADC\_WET}} \times 100, 0, 100\right)$$
  - Nhãn hiển thị (`wet_label`):
    - `< 15%`: `"DRY"` (`"Khô"`)
    - `15% .. < 30%`: `"TRANSITION"` (`"Đang ướt"` - vùng chuyển tiếp)
    - `30% .. < 50%`: `"WET"` (`"Đang ướt"`)
    - `>= 50%`: `"HEAVY_WET"` (`"Ướt nhiều"`)
- **Cảm biến ánh sáng LDR (Hysteresis sáng/tối):**
  - Chuyển từ Sáng sang Tối khi độ tối vượt `LDR_DARK_ENTER_THRESHOLD`.
  - Chuyển từ Tối sang Sáng khi độ tối giảm xuống dưới `LDR_BRIGHT_EXIT_THRESHOLD`.
- **Thời gian xác nhận khô (`dry_confirm_target_sec`):**
  - Vận hành chuẩn: `180 giây` (`180000 ms`).
  - Chế độ Demo: `10 giây` (`10000 ms`), kèm cờ `"demo_fast_dry": true` trong bản tin trạng thái để hiển thị rõ trên giao diện.
- **Xử lý lỗi DHT11 (`dht_valid == false`):**
  - Đọc mỗi `2500 ms`. Khi `isnan(t)` hoặc `isnan(h)` hoặc ngoài ngưỡng vật lý (`-10..60°C`, `0..100%`), đặt `dht_valid = false`, giữ `temperature = null`, `humidity = null` trong JSON (không gán số giả) và **cấm mở sào tự động**.

---

## 3. Quy Tắc Bộ Đếm Phiên Phơi & Lưu Trữ Cục Bộ (W04)

1. **Mẻ đồ (`batch_id`) và Phiên phơi (`session_id`):**
   - Một mẻ đồ (`batch_id`, ví dụ `"BATCH_20261112_001"`) gồm một hoặc nhiều phiên phơi (`session_id`).
   - Khi sào chuyển `RETRACTED -> EXTENDED`: mở phiên mới, ghi `session_start_ms = millis()` và `session_start_epoch` (nếu đã đồng bộ NTP).
   - Khi sào chuyển `EXTENDED -> RETRACTED`: đóng phiên hiện tại, tính `session_duration_sec = (millis() - session_start_ms) / 1000`, cộng vào `accumulated_sec` của mẻ đồ, lưu vào NVS (`Preferences`) và phát bản tin `session_closed`.
   - **Chống cộng trùng:** Lệnh mở lặp khi đang `EXTENDED` không tạo phiên mới; lệnh thu lặp khi đang `RETRACTED` không cộng thêm thời gian.
2. **Tổng thời gian phơi của mẻ hiện tại (`total_drying_sec`):**
   - Nếu đang `RETRACTED`: `total_drying_sec = accumulated_sec`.
   - Nếu đang `EXTENDED`: `total_drying_sec = accumulated_sec + current_session_sec`.
3. **Thao tác Reset (`RESET_COUNTER`):**
   - Nếu sào đang `EXTENDED`, đóng phiên hiện tại của mẻ cũ với `reason: "BATCH_RESET"` và phát bản tin kết thúc phiên/mẻ cũ để Cloud giữ nguyên lịch sử mẻ cũ.
   - Tạo `batch_id` mới, đặt `accumulated_sec = 0`, `session_count = 0`.
   - Nếu sào đang `EXTENDED` tại thời điểm reset, bắt đầu ngay phiên số 1 của mẻ mới.
4. **Xử lý mất điện (Power Interruption - F09, F24):**
   - Trạng thái `batch_id`, `accumulated_sec`, `rod_state`, `control_mode` được ghi vào NVS khi chuyển trạng thái.
   - Nếu trước khi mất điện sào đang `EXTENDED`, khi khởi động lại ESP32 phát hiện cờ `session_active_in_nvs == true`: hệ thống đánh dấu phiên bị gián đoạn (`interrupted: true`, `reason: "POWER_LOSS"`), **không** tự cộng khoảng thời gian mất điện không xác định vào `accumulated_sec`.

---

## 4. Cấu Trúc MQTT Topics & Hợp Đồng JSON (W01)

- **Prefix nhánh thật:** `aerodry/g21/{device_id}/...` (mặc định `device_id = "esp32_01"`).
- **Prefix nhánh Simulation Mode (F23):** `aerodry/g21/sim/{device_id}/...` (tách biệt hoàn toàn để không điều khiển servo thật và không ghi vào lịch sử thật trên Firestore).
- **Quy tắc Retained & QoS:**
  - **Không** dùng `retained = true` cho topic lệnh (`cmd`) để tránh tự chạy lại lệnh cơ cấu cũ khi kết nối lại (F18, F24).
  - Mỗi lệnh từ web phải có `cmd_id` và `issued_at`; ESP32 phản hồi qua topic `ack`.

### 4.1. Danh sách Topics

| Chiều | Topic | Chu kỳ / Sự kiện | Retained | Mô tả |
| :--- | :--- | :--- | :---: | :--- |
| ESP32 → Broker | `aerodry/g21/esp32_01/telemetry` | Mỗi 2.5 giây | `false` | Dữ liệu cảm biến, trạng thái thiết bị và bộ đếm thời gian thực cho Dashboard (F17) & bộ lọc 60s lưu Firestore (F19). |
| ESP32 → Broker | `aerodry/g21/esp32_01/state` | Khi đổi trạng thái | `true` | Trạng thái sào, chế độ Auto/Manual, quạt, đèn, mẻ đồ hiện tại. |
| ESP32 → Broker | `aerodry/g21/esp32_01/session` | Khi mở / đóng phiên hoặc reset mẻ | `false` | Bản tin mốc phiên phơi và mẻ đồ để lưu ngay vào Firestore `drying_sessions` & `batches`. |
| ESP32 → Broker | `aerodry/g21/esp32_01/event` | Khi phát sinh cảnh báo / sự kiện | `false` | Sự kiện thu tự động do mưa, cảnh báo mưa khi Manual, độ ẩm cao kéo dài, mất điện... kích hoạt PushSafer & SMTP (W21) và lưu `events` (W18). |
| ESP32 → Broker | `aerodry/g21/esp32_01/heartbeat` | Mỗi 10 giây (+ LWT) | `true` | Trạng thái `ONLINE`/`OFFLINE`, `rssi`, `ip`, `uptime_sec` (F15). |
| ESP32 → Broker | `aerodry/g21/esp32_01/ack` | Ngay khi xử lý lệnh | `false` | Phản hồi mã lệnh `cmd_id` (`ACCEPTED`, `REJECTED`, `EXPIRED`) (F18). |
| Web/Node-RED → ESP32 | `aerodry/g21/esp32_01/cmd` | Khi người dùng bấm nút trên Web | `false` | Lệnh điều khiển sào, chế độ, quạt, đèn, reset bộ đếm, cấu hình demo. |

---

### 4.2. Mẫu JSON Payload Chi Tiết

#### A. Bản tin Telemetry (`aerodry/g21/esp32_01/telemetry`)
```json
{
  "schema_ver": "1.0",
  "group_id": "G21_24C11",
  "device_id": "esp32_01",
  "is_simulation": false,
  "timestamp": 1762940400,
  "time_synced": true,
  "uptime_sec": 3625,
  "wifi": {
    "rssi": -56,
    "ip": "192.168.1.188"
  },
  "sensors": {
    "dht_valid": true,
    "temperature_c": 32.5,
    "humidity_pct": 62.0,
    "rain_adc": 3670,
    "wet_percent": 5,
    "wet_label": "DRY",
    "wet_text_vi": "Khô",
    "ldr_adc": 1120,
    "light_percent": 73,
    "is_dark": false
  },
  "actuators": {
    "control_mode": "AUTO",
    "rod_state": "EXTENDED",
    "servo_target_deg": 90,
    "fan_state": "OFF",
    "light_mode": "AUTO",
    "light_state": "OFF"
  },
  "drying": {
    "batch_id": "BATCH_1762932000_1",
    "session_id": 2,
    "is_session_open": true,
    "session_start_epoch": 1762938000,
    "last_retract_epoch": 1762936200,
    "current_session_sec": 2400,
    "accumulated_sec": 5291,
    "total_drying_sec": 7691,
    "formatted_time": "02:08:11",
    "dry_confirm_elapsed_sec": 0,
    "dry_confirm_target_sec": 180,
    "demo_fast_dry": false
  }
}
```
*(Nếu DHT11 lỗi: `"dht_valid": false`, `"temperature_c": null`, `"humidity_pct": null`)*

#### B. Bản tin Phiên Phơi (`aerodry/g21/esp32_01/session`)
```json
{
  "schema_ver": "1.0",
  "group_id": "G21_24C11",
  "device_id": "esp32_01",
  "is_simulation": false,
  "event_type": "SESSION_CLOSED",
  "batch_id": "BATCH_1762932000_1",
  "session_id": 2,
  "start_epoch": 1762938000,
  "end_epoch": 1762940400,
  "time_synced": true,
  "session_duration_sec": 2400,
  "batch_total_drying_sec": 7691,
  "formatted_batch_total": "02:08:11",
  "trigger_mode": "AUTO",
  "reason": "RAIN",
  "reason_vi": "Thu tự động do phát hiện mưa",
  "interrupted": false,
  "sensors_snapshot": {
    "temperature_c": 29.0,
    "humidity_pct": 78.5,
    "wet_percent": 38,
    "is_dark": false
  }
}
```
*Các giá trị `event_type` của `session`:* `"SESSION_OPENED"`, `"SESSION_CLOSED"`, `"BATCH_RESET"`, `"SESSION_INTERRUPTED_POWER"`.  
*Các giá trị `reason`:* `"RAIN"`, `"HIGH_HUMIDITY"`, `"DARK"`, `"DRY_RECOVERED"`, `"MANUAL_BTN"`, `"MANUAL_WEB"`, `"BATCH_RESET"`, `"POWER_LOSS"`.

#### C. Bản tin Sự Kiện & Cảnh Báo (`aerodry/g21/esp32_01/event`)
```json
{
  "schema_ver": "1.0",
  "event_id": "EVT_esp32_01_3625000_1",
  "group_id": "G21_24C11",
  "device_id": "esp32_01",
  "is_simulation": false,
  "timestamp": 1762940400,
  "time_synced": true,
  "event_code": "AUTO_RAIN_RETRACT",
  "severity": "WARNING",
  "title_vi": "Cảnh báo mưa - Đã tự động thu sào",
  "message_vi": "Phát hiện mưa (mức ướt 38%). Sào đã được thu tự động vào mái che. Tổng thời gian đã phơi của mẻ hiện tại: 02:08:11.",
  "batch_id": "BATCH_1762932000_1",
  "session_id": 2,
  "total_drying_sec": 7691,
  "formatted_time": "02:08:11",
  "rod_state": "RETRACTED",
  "control_mode": "AUTO",
  "sensors": {
    "dht_valid": true,
    "temperature_c": 29.0,
    "humidity_pct": 78.5,
    "wet_percent": 38,
    "is_dark": false
  },
  "channels": ["PUSHSAFER", "EMAIL"]
}
```
*Các mã `event_code`:*
- `AUTO_RAIN_RETRACT`: Đang phơi ở Auto chuyển sang thu tự động do mưa (`wet_percent >= 30%`) -> gửi **PushSafer + Email**.
- `MANUAL_RAIN_WARNING`: Đang mở sào ở Manual mà phát hiện mưa (`wet_percent >= 30%`) -> gửi **PushSafer + Email** nhắc người dùng thu sào.
- `HIGH_HUMIDITY_PROLONGED`: Độ ẩm cao (`>= 85%`) kéo dài vượt ngưỡng cấu hình (ví dụ 15 phút) -> gửi **Email** nhắc kiểm tra đồ phơi và cân nhắc bật quạt.
- `AUTO_HUMIDITY_RETRACT`: Thu tự động do độ ẩm cao (`>= 85%`) -> lưu nhật ký Firestore.
- `AUTO_DARK_RETRACT`: Thu tự động do trời tối -> lưu nhật ký Firestore.
- `AUTO_DRY_EXTEND`: Tự động đưa sào ra lại sau khi xác nhận khô đủ thời gian -> lưu nhật ký Firestore.
- `SENSOR_DHT_ERROR`: Cảm biến DHT11 báo lỗi đọc liên tiếp -> hiển thị cảnh báo lỗi cảm biến.
- `POWER_INTERRUPTED`: Phát hiện gián đoạn nguồn điện trong lúc đang phơi -> lưu nhật ký Firestore.

#### D. Bản tin Lệnh Điều Khiển (`aerodry/g21/esp32_01/cmd`) & Phản Hồi (`ack`)
**Lệnh gửi từ Node-RED/Web (`cmd`):**
```json
{
  "cmd_id": "CMD_1762940410_99",
  "issued_at": 1762940410,
  "ttl_sec": 15,
  "action": "SET_ROD",
  "params": {
    "target": "RETRACTED",
    "demo_fast_dry": false
  }
}
```
*Các giá trị `action` hỗ trợ:*
- `"SET_ROD"`: `params.target = "EXTENDED" | "RETRACTED"` (Tự động chuyển `control_mode` sang `"MANUAL"`).
- `"SET_MODE"`: `params.mode = "AUTO" | "MANUAL"`.
- `"SET_FAN"`: `params.state = "ON" | "OFF"`.
- `"SET_LIGHT"`: `params.mode = "AUTO" | "MANUAL"`, `params.state = "ON" | "OFF"`.
- `"RESET_COUNTER"`: Đặt lại bộ đếm thời gian phơi sang mẻ đồ mới.
- `"SET_DEMO_CONFIG"`: `params.demo_fast_dry = true | false` (Đổi thời gian chờ xác nhận khô giữa 10s và 180s).

**Phản hồi từ ESP32 (`ack`):**
```json
{
  "cmd_id": "CMD_1762940410_99",
  "device_id": "esp32_01",
  "timestamp": 1762940411,
  "status": "ACCEPTED",
  "reason": "OK",
  "resulting_state": {
    "control_mode": "MANUAL",
    "rod_state": "RETRACTED",
    "fan_state": "OFF",
    "light_mode": "AUTO",
    "light_state": "OFF",
    "batch_id": "BATCH_1762932000_1",
    "total_drying_sec": 7691
  }
}
```
