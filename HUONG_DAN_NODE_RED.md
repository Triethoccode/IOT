# HƯỚNG DẪN CHI TIẾT CÁCH NỐI CÁC KHỐI (NODES) & NÂNG CẤP GIAO DIỆN TRÊN NODE-RED
**Dự án:** AeroDry IoT (SmartBreeze Pro) – Hệ thống giàn phơi thông minh  
**File luồng chính:** `nodered_data/flows.json`

---

## 1. NGUYÊN TẮC CỐT LÕI KHI NỐI DÂY TRONG NODE-RED

Trong Node-RED, mọi dữ liệu chạy qua dây nối giữa các khối đều nằm trong một biến đối tượng duy nhất tên là **`msg`**, trong đó quan trọng nhất là:
* **`msg.payload`**: Chứa giá trị chính (ví dụ: số nhiệt độ `32.5`, chuỗi `"02:05:20"`, hoặc đối tượng JSON `{"action": "EXTEND"}`).
* **`msg.topic`**: Chứa nhãn phân loại (dùng để phân biệt đường biểu đồ `"Nhiệt độ (°C)"` hay `"Độ ẩm (%)"`, hoặc tên kênh MQTT).

---

## 2. SƠ ĐỒ GIẢI THÍCH CÁCH NỐI TỪNG CỤM TRONG `flows.json`

### Cụm 1: Luồng Nhận Dữ Liệu Cảm Biến & Bộ Đếm Thời Gian Phơi (Uplink)

```mermaid
flowchart LR
    MQTT_IN["🟣 MQTT In\nsmartdry/sensor/telemetry"] --> FN1["🟠 Function Node 1\nXử lý JSON & Tính giờ phơi\n(13 đầu ra)"]
    SIM1["🔵 Nút Test Nắng ráo"] --> FN1
    SIM2["🔵 Nút Test Mưa bóng mây"] --> FN1
    SIM3["🔵 Nút Test Mưa rào lớn"] --> FN1

    FN1 -- "Chân 1 (rssi)" --> G_RSSI["🟢 Gauge: WiFi RSSI"]
    FN1 -- "Chân 2 (ip)" --> T_IP["🟢 Text: Địa chỉ IP"]
    FN1 -- "Chân 3 (online)" --> T_ON["🟢 Text: Trạng thái Online"]
    FN1 -- "Chân 4 (temp)" --> G_TEMP["🟢 Gauge: Nhiệt độ"]
    FN1 -- "Chân 4 (temp)" --> CHART1["🟢 Chart: Đồ thị 24h"]
    FN1 -- "Chân 5 (hum)" --> G_HUM["🟢 Gauge: Độ ẩm"]
    FN1 -- "Chân 5 (hum)" --> CHART1
    FN1 -- "Chân 6 (rain_pct)" --> G_RAIN["🟢 Gauge: Mức mưa %"]
    FN1 -- "Chân 7 (weather)" --> T_WEA["🟢 Text: Kịch bản thời tiết"]
    FN1 -- "Chân 8 (rack_state)" --> T_RACK["🟢 Text: Vị trí sào"]
    FN1 -- "Chân 9 (extended_at)" --> T_EXT["🟢 Text: Giờ đẩy sào"]
    FN1 -- "Chân 10 (retracted_at)" --> T_RET["🟢 Text: Giờ thu sào"]
    FN1 -- "Chân 11 (drying_time)" --> T_TOT["🟢 Text: Tổng giờ phơi"]
    FN1 -- "Chân 12 (advice)" --> T_ADV["🟢 Text: Gợi ý bật quạt"]
    FN1 -- "Chân 13 (full JSON)" --> DBG_DB["🟢 Debug / Cloud Firestore"]
```

#### Giải thích tại sao `Function Node 1` lại có 13 chân đầu ra (Outputs):
* Mạch ESP32 gửi lên **1 cục JSON gộp chung** tất cả thông số:
  ```json
  {
    "temp": 32.5, "hum": 62, "rain_pct": 5, "weather_type": "NANG_RAO",
    "drying_time_str": "02:05:20", "fan": false, "rssi": -56, "ip": "192.168.1.108", "rack_state": 1
  }
  ```
* Nhưng mỗi đồng hồ (`ui_gauge`) hoặc dòng chữ (`ui_text`) trên giao diện Web chỉ nhận **1 giá trị đơn lẻ** trong `msg.payload`.
* Vì vậy, `Function Node 1` dùng lệnh `return [ out1, out2, ..., out13 ]` để tách gói JSON thành **13 chân đầu ra riêng biệt** (bạn rê chuột vào từng chấm tròn bên phải khối `Function Node 1` sẽ thấy thứ tự từ trên xuống dưới từ 1 đến 13).
* **Đặc biệt ở Chân 4 (Nhiệt độ) và Chân 5 (Độ ẩm):** Mỗi chân được nối vào **2 nơi cùng lúc** (vừa nối vào đồng hồ `Gauge`, vừa nối chung vào `Biểu đồ Nhiệt độ & Độ ẩm 24h`). Nhờ có `topic: "Nhiệt độ (°C)"` và `topic: "Độ ẩm (%)"`, biểu đồ `ui_chart` tự động vẽ thành **2 đường màu khác nhau** trên cùng 1 đồ thị!

---

### Cụm 2: Luồng Điều Khiển Sào Servo, Quạt Sấy & Đèn (Downlink)

```mermaid
flowchart LR
    SW_MODE["🟢 Switch: Auto / Manual\nPayload: {mode: 'AUTO'/'MANUAL'}"] --> MQTT_RACK["🟣 MQTT Out\nsmartdry/control/rack"]
    BTN_EXT["🟢 Button: EXTEND (90°)\nPayload: {action: 'EXTEND'}"] --> MQTT_RACK
    BTN_RET["🟢 Button: RETRACT (0°)\nPayload: {action: 'RETRACT'}"] --> MQTT_RACK
    BTN_RST["🟢 Button: RESET TIMER\nPayload: {action: 'RESET_TIMER'}"] --> MQTT_RACK

    BTN_EXT --> FN_FB["🟠 Function: Cập nhật UI tức thì"]
    BTN_RET --> FN_FB
    BTN_RST --> FN_FB

    SW_FAN["🟢 Switch: Quạt sấy (FAN)\nPayload: {fan: true/false}"] --> MQTT_DRY["🟣 MQTT Out\nsmartdry/control/dryer"]
    SW_LED["🟢 Switch: Đèn ban công\nPayload: {light: true/false}"] --> MQTT_DRY
```

* **Cách hoạt động:**
  * Trong mỗi nút bấm (`ui_button`) hoặc công tắc (`ui_switch`), mình đã cấu hình sẵn ô **Payload** dưới dạng JSON khớp với hàm `mqttCallback()` trong code C++ của ESP32:
    * Nút **EXTEND**: gửi `{"action": "EXTEND"}` $\rightarrow$ nối vào `MQTT Out (smartdry/control/rack)`.
    * Nút **RETRACT**: gửi `{"action": "RETRACT"}` $\rightarrow$ nối vào `MQTT Out (smartdry/control/rack)`.
    * Nút **RESET TIMER**: gửi `{"action": "RESET_TIMER"}` $\rightarrow$ nối vào `MQTT Out (smartdry/control/rack)`.
    * Công tắc **QUẠT SẤY**: khi bật gửi `{"fan": true}`, khi tắt gửi `{"fan": false}` $\rightarrow$ nối vào `MQTT Out (smartdry/control/dryer)`.

---

### Cụm 3: Luồng Cảnh Báo Mưa Khẩn Cấp (Emergency Notification - NC6, NC7)

```mermaid
flowchart LR
    MQTT_ALT["🟣 MQTT In\nsmartdry/alert/emergency"] --> FN2["🟠 Function Node 2\nĐóng gói Cảnh báo Mưa\n(3 đầu ra)"]
    FN2 -- "Chân 1" --> PUSH["PushSafer API (NC6)"]
    FN2 -- "Chân 2" --> EMAIL["SMTP Gmail (NC7)"]
    FN2 -- "Chân 3" --> TOAST["🟢 ui_toast: Popup cảnh báo đỏ trên Web"]
```

---

### Cụm 4: Luồng Màn Hình Đăng Nhập (Login View - NC9)

```mermaid
flowchart LR
    IN_MAIL["🟢 Input: Email"] --> FN_AUTH["🟠 Function: Kiểm tra Đăng nhập"]
    IN_PASS["🟢 Input: Password"] --> FN_AUTH
    BTN_LOGIN["🟢 Button: ĐĂNG NHẬP"] --> FN_AUTH
    FN_AUTH -- "Chân 1" --> TXT_AUTH["🟢 Text: Đã xác thực"]
    FN_AUTH -- "Chân 2" --> UI_CTRL["🟢 ui_control: Tự nhảy sang Main Dashboard"]
    FN_AUTH -- "Chân 3" --> TOAST2["🟢 ui_toast: Thông báo chào mừng"]
```

---

## 3. CÁCH NÂNG CẤP GIAO DIỆN (UI) TRONG NODE-RED ĐẸP HƠN

Mặc định `node-red-dashboard` dùng giao diện phẳng cổ điển. Để biến giao diện thành **Smart Home Dashboard hiện đại**, bạn có **3 kỹ thuật mạnh nhất**:

1. **Kỹ thuật 1 – Tiêm Custom CSS toàn cục bằng khối `ui_template` (`Added to site <head> section`):**
   * Chèn một khối `ui_template` chứa CSS giúp bo tròn các khung Cột 1, Cột 2, Cột 3 (`border-radius: 14px`), tạo bóng đổ nổi (`box-shadow`), đổi thanh tiêu đề sang màu **Gradient Xanh Dương – Ngọc Lục Bảo**, làm nổi bật nút bấm khi di chuột (`hover`).
2. **Kỹ thuật 2 – Thêm Widget HTML/SVG động (`ui_template` trong Group):**
   * Tạo **Đồng hồ LED Kỹ thuật số (Digital Timer Card)** cỡ lớn hiển thị thời gian đã phơi `02:05:20` và **Mô phỏng hình ảnh Sào phơi xoay góc 0° / 90° + Cánh quạt sấy quay tròn** ngay trên giao diện!
3. **Kỹ thuật 3 – Tinh chỉnh Layout & Theme trong bảng `Dashboard` bên phải Editor:**
   * Mở tab `Dashboard` $\rightarrow$ `Theme` để chỉnh font chữ, màu nền, hoặc `Site` $\rightarrow$ `Sizes` để tăng kích thước ô lưới.
