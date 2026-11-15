# CẨM NANG KỸ THUẬT: ĐẶC TẢ TOÀN BỘ CÁC CỤM CHỨC NĂNG TRÊN NODE-RED
## ĐỒ ÁN: AERODRY IoT (SMARTBREEZE PRO) – HỆ THỐNG GIÀN PHƠI THÔNG MINH
**Học phần:** Vật lý cho Công nghệ Thông tin (PHY00007) – Lớp 24C11 – Nhóm 21  
**Tài liệu chuẩn hóa đối chiếu 100% theo Đề xuất Đồ án Chính thức ([main (2).pdf](file:///D:/III_HK1/VL/Project/main%20(2).pdf))**

---

## 1. KIẾN TRÚC VÀ CÁC LUỒNG DỮ LIỆU CỐT LÕI (MỤC 4.1 TRONG PROPOSAL)

Theo Mục 4.1 (Trang 10) của bản Đề xuất đồ án, hệ thống AeroDry IoT được tổ chức thành 4 luồng dữ liệu chính:

```mermaid
flowchart TD
    subgraph ESP32["Mạch Biên ESP32"]
        SENS["Cảm biến: DHT11, Mưa ADC, LDR"]
        LOCAL_CTRL["Điều khiển tại chỗ & FSM (F06, F07, F08)"]
        TIMER["Bộ đếm thời gian phơi thực tế (F09, F10)"]
        ACT["Servo Giàn phơi, Quạt, Đèn, LCD"]
    end

    subgraph MQTT_BROKER["MQTT Broker Trung tâm"]
        T_TELEM["aerodry/g21/esp32_01/telemetry"]
        T_CMD["aerodry/g21/esp32_01/cmd"]
        T_ACK["aerodry/g21/esp32_01/ack"]
        T_HB["aerodry/g21/esp32_01/heartbeat"]
        T_EVT["aerodry/g21/esp32_01/event"]
    end

    subgraph NODERED["Node-RED Server & Middleware Gateway"]
        UPLINK["Luồng Giám sát & Telemetry\n(Function Node 1 & Bộ lọc 60s)"]
        DOWNLINK["Luồng Điều khiển & Cổng lệnh\n(Gateway so khớp ACK & Timeout 5s)"]
        ALERT["Luồng Cảnh báo Khẩn cấp\n(Function Node 2 & Cooldown 15p)"]
        DASHBOARD["Giao diện Bảng điều khiển Web & Mô phỏng\n(Web Stitch UI, Gauges, Charts)"]
    end

    subgraph CLOUD["Dịch vụ Đám mây & Người dùng"]
        FS[("Google Cloud Firestore\n(sensor_samples, batches, events, users)")]
        NOTIFY["PushSafer & Gmail SMTP (F21, F22)"]
        USER["Người dùng đăng nhập Web Dashboard (F16, F17)"]
    end

    %% Luồng 1: Giám sát
    SENS --> TIMER --> LOCAL_CTRL
    LOCAL_CTRL -- "2.5s / lần" --> T_TELEM --> UPLINK
    UPLINK --> DASHBOARD
    UPLINK -- "Bộ lọc 60s" --> FS

    %% Luồng 2: Điều khiển
    USER -- "Bấm lệnh + Session Token" --> DASHBOARD --> DOWNLINK
    DOWNLINK -- "MQTT cmd (TTL 5s)" --> T_CMD --> ACT
    ACT -- "MQTT ack" --> T_ACK --> DOWNLINK
    DOWNLINK -- "Phản hồi ACCEPTED / REJECTED" --> DASHBOARD
    ACT -.->|Heartbeat 5s| T_HB --> DOWNLINK

    %% Luồng 3: Cảnh báo
    LOCAL_CTRL -- "Sự kiện mưa khẩn cấp" --> T_EVT --> ALERT
    ALERT --> DASHBOARD
    ALERT -- "Gửi đích danh theo device_id" --> NOTIFY
    ALERT --> FS
```

* **Luồng 1 - Giám sát (Monitoring Flow):** Cảm biến và nút nhấn $\rightarrow$ ESP32 $\rightarrow$ MQTT broker $\rightarrow$ Node-RED $\rightarrow$ Dashboard và Firestore.
* **Luồng 2 - Điều khiển (Control Flow):** Người dùng đã đăng nhập $\rightarrow$ Dashboard $\rightarrow$ Node-RED Gateway $\rightarrow$ MQTT $\rightarrow$ ESP32 $\rightarrow$ Servo, relay quạt hoặc LED. ESP32 gửi lại bản tin ACK để cập nhật giao diện.
* **Luồng 3 - Cảnh báo (Alert Flow):** ESP32 phát hiện mưa $\rightarrow$ MQTT $\rightarrow$ Node-RED $\rightarrow$ PushSafer và Email SMTP gửi đích danh tới người dùng sở hữu thiết bị (`device_id`).
* **Luồng 4 - Mô phỏng (Simulation Flow - F23):** Giả lập dữ liệu thời tiết (Nắng ráo, Độ ẩm kéo dài, Mưa lớn) để kiểm thử giao diện mà không tác động mạch thật hay gửi mail rác.

---

## 2. BẢNG ĐỐI CHIẾU CHỨC NĂNG (F01–F24) & PHÂN CÔNG (W01–W24)

Dưới đây là bảng chuẩn hóa toàn bộ các chức năng theo đúng **Chương 2 (Mục F)** và **Chương 5.3 (Mục W)** trong Proposal:

| Mã CN | Tên Chức năng trong Đề xuất | Mã W | Phụ trách chính | Vị trí Mã nguồn cụ thể |
| :---: | :--- | :---: | :---: | :--- |
| **F01** | Đọc nhiệt độ và độ ẩm DHT11 | W02 | Phong | [esp32_aerodry/sensors.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/sensors.h) |
| **F02** | Đọc trạng thái ướt (cảm biến mưa ADC) | W03 | Phong | [esp32_aerodry/sensors.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/sensors.h) |
| **F03** | Đọc ánh sáng LDR (ngưỡng trễ sáng/tối) | W02 | Phong | [esp32_aerodry/sensors.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/sensors.h) |
| **F04** | Thu và đưa sào ra (Servo 0° và 90°) | W12 | Linh | [esp32_aerodry/esp32_aerodry.ino](file:///D:/III_HK1/VL/Project/esp32_aerodry/esp32_aerodry.ino) |
| **F05** | Điều khiển bằng nút nhấn vật lý | W12 | Linh | [esp32_aerodry/local_io.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/local_io.h) |
| **F06** | Chuyển chế độ Auto và Manual | W05 | Phong | [esp32_aerodry/state_machine.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/state_machine.h) |
| **F07** | Thu sào tự động khi mưa / độ ẩm cao | W03, W05 | Phong | [esp32_aerodry/state_machine.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/state_machine.h) |
| **F08** | Chờ khô trước khi mở lại (Xác nhận 180s) | W03 | Phong | [esp32_aerodry/state_machine.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/state_machine.h) |
| **F09** | Ghi nhận thời gian phơi cộng dồn | W04 | Phong | [esp32_aerodry/drying_tracker.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/drying_tracker.h) |
| **F10** | Đặt lại bộ đếm mẻ phơi mới (Reset) | W04 | Phong | [esp32_aerodry/drying_tracker.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/drying_tracker.h) |
| **F11** | Hiển thị tại chỗ LCD1602 I2C | W13 | Linh | [esp32_aerodry/esp32_aerodry.ino](file:///D:/III_HK1/VL/Project/esp32_aerodry/esp32_aerodry.ino) |
| **F12** | Điều khiển quạt sấy đối lưu | W13 | Linh | [esp32_aerodry/local_io.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/local_io.h) |
| **F13** | Điều khiển đèn chiếu sáng ban công | W13 | Linh | [esp32_aerodry/local_io.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/local_io.h) |
| **F14** | Cấu hình Wi-Fi SoftAP / WiFiManager | W14 | Linh | [esp32_aerodry/esp32_aerodry.ino](file:///D:/III_HK1/VL/Project/esp32_aerodry/esp32_aerodry.ino) |
| **F15** | Theo dõi kết nối (Heartbeat, Online/Offline) | W14, W17 | Linh | [nodered_data/lib/control-gateway.js](file:///D:/III_HK1/VL/Project/nodered_data/lib/control-gateway.js) |
| **F16** | Đăng nhập và đăng xuất (Xác thực tài khoản) | W20 | Triết | [nodered_data/lib/control-gateway.js](file:///D:/III_HK1/VL/Project/nodered_data/lib/control-gateway.js), [UI_Stitch/Login Page](file:///D:/III_HK1/VL/Project/UI_Stitch/Login%20Page) |
| **F17** | Dashboard trực tuyến giám sát thời gian thực | W16 | Triết | [nodered_data/flows.json](file:///D:/III_HK1/VL/Project/nodered_data/flows.json), [UI_Stitch/GiaoDienChinh](file:///D:/III_HK1/VL/Project/UI_Stitch/GiaoDienChinh) |
| **F18** | Điều khiển từ website & Phản hồi thiết bị | W17 (UI) | Triết | [nodered_data/ui/control.js](file:///D:/III_HK1/VL/Project/nodered_data/ui/control.js) |
| **F19** | Lưu lịch sử cloud (Firestore chu kỳ 60s) | W18 | Triết (Chuyển giao Phong) | [backend_cloud_notify/src/firestoreService.js](file:///D:/III_HK1/VL/Project/backend_cloud_notify/src/firestoreService.js) |
| **F20** | Biểu đồ nhiệt ẩm 24h & Nhật ký phiên phơi | W19 | Triết (UI), Phong (Data) | [backend_cloud_notify/src/historyQueryService.js](file:///D:/III_HK1/VL/Project/backend_cloud_notify/src/historyQueryService.js), `ui_chart` |
| **F21** | Thông báo đẩy PushSafer về điện thoại | W21 | Triết (Chuyển giao Phong) | [backend_cloud_notify/src/notificationService.js](file:///D:/III_HK1/VL/Project/backend_cloud_notify/src/notificationService.js) |
| **F22** | Email cảnh báo mưa & độ ẩm cao qua SMTP | W21 | Triết (Chuyển giao Phong) | [backend_cloud_notify/src/notificationService.js](file:///D:/III_HK1/VL/Project/backend_cloud_notify/src/notificationService.js) |
| **F23** | Chế độ mô phỏng kịch bản thời tiết độc lập | W22 | Triết | [nodered_data/ui/control.js](file:///D:/III_HK1/VL/Project/nodered_data/ui/control.js), `ui_btn_sim_*` |
| **F24** | Xử lý gián đoạn mạng, mất điện & lỗi cảm biến | W04, W05 | Phong | [esp32_aerodry/mqtt_contract.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/mqtt_contract.h), [state_machine.h](file:///D:/III_HK1/VL/Project/esp32_aerodry/state_machine.h) |

---

## 3. CHI TIẾT TỪNG CỤM FUNCTION TRÊN CANVAS NODE-RED

*Toàn bộ tên hiển thị trên giao diện Node-RED đã được tinh chỉnh thuần túy theo **chức năng kỹ thuật**, không để lộ mã công việc viết tắt hay tên cá nhân để đảm bảo tính chuyên nghiệp cao nhất:*

### Cụm 1: Luồng Thu thập Dữ liệu Cảm biến & Thời gian phơi (Uplink)
* **Node chính:** `Function Node 1: Xử lý Telemetry, Bộ lọc 60s Firestore & Lịch sử 24h` (`fn_process_telemetry`).
* **Nguyên lý hoạt động:**
  1. Hứng bản tin JSON định kỳ 2.5s từ node `MQTT In (telemetry)`.
  2. Kiểm tra cờ `dht_valid`: nếu cảm biến lỗi, gán `temp = null`, `hum = null`, phát nhãn cảnh báo `⚠️ LỖI CẢM BIẾN DHT11` và khóa tính năng tự động mở sào.
  3. Quản lý trạng thái chuyển động của sào phơi:
     * Khi sào chuyển sang $90^\circ$: ghi nhận mốc giờ bắt đầu mở phơi (`extend_timestamp`).
     * Khi sào chuyển về $0^\circ$: ghi nhận mốc giờ thu (`retract_timestamp`), tính thời lượng phiên phơi (`duration_sec`) và lưu vào mảng lịch sử 24h.
  4. **Bộ lọc 60 giây (F19):** Độc lập với chu kỳ 2.5s của Web, cứ mỗi 60 giây node mới xuất 1 bản ghi vào cổng số 13 nối sang node `Bản ghi lưu Cloud Firestore` để ghi vào database.
  5. **13 Cổng xuất dữ liệu:** Xuất trực tiếp dữ liệu số đến các đồng hồ đo (Nhiệt độ, Độ ẩm, Mức mưa, WiFi RSSI, Giờ mở/thu, Tổng giờ phơi thực tế).

---

### Cụm 2: Luồng Điều khiển Thiết bị & Cổng Lệnh (Downlink)
* **Node chính:** `Cổng điều khiển thiết bị: Xử lý lệnh, so khớp ACK & Heartbeat` (`fn_linh_control_gateway`).
* **Nguyên lý hoạt động:**
  1. **Nhận diện sống còn (F15):** Định kỳ 5s nhận heartbeat từ ESP32. Node `Kiểm tra timeout & trạng thái kết nối (1s)` quét liên tục: nếu quá 25s không có heartbeat hoặc mất kết nối Broker, Gateway chuyển sang `OFFLINE` và **khóa toàn bộ nút bấm điều khiển** trên Web.
  2. **Tạo lệnh và cấp `cmd_id` (F18):** Khi người dùng click nút trên web (Đẩy sào, Thu sào, Quạt, Đèn, Reset), Gateway tạo một mã ngẫu nhiên `cmd_id`, gắn thời hạn hiệu lực $TTL = 5\text{s}$, gửi xuống ESP32 qua node `Cổng gửi lệnh điều khiển MQTT (cmd)`.
  3. **So khớp ACK chống lệnh ma:** Khi nhận bản tin từ node `Nhận ACK phản hồi thiết bị`, Gateway đối chiếu đúng `cmd_id`, `boot_id` và `connection_id`. Nếu khớp, trả về trạng thái `ACCEPTED` lên giao diện; nếu quá 5s không có phản hồi, trả về `TIMEOUT`.

---

### Cụm 3: Luồng Cảnh báo Mưa Khẩn cấp qua PushSafer & Email SMTP
* **Node chính:** `Function Node 2: Xử lý Cảnh báo Mưa, PushSafer & Email SMTP` (`fn_emergency_alert`).
* **Nguyên lý hoạt động:**
  1. Lắng nghe sự kiện từ node `MQTT In (event)` khi ESP32 phát hiện mưa hoặc độ ẩm cao kéo dài (F21, F22).
  2. **Trích xuất `device_id`:** Lấy chính xác mã thiết bị gây ra cảnh báo (ví dụ `esp32_01`).
  3. **Thời gian chờ chống gửi trùng (Cooldown 15 phút):** Kích hoạt bộ đếm 15 phút. Nếu trong 15 phút này trời vẫn tiếp tục mưa, các sự kiện sau sẽ bị chặn lại để không gây nghẽn email người dùng.
  4. **Xuất 3 luồng cảnh báo đồng thời:**
     * Cổng 1 $\rightarrow$ `Bản tin gửi PushSafer API`: Gửi thông báo đẩy đến ứng dụng điện thoại.
     * Cổng 2 $\rightarrow$ `Nội dung Email cảnh báo SMTP`: Tạo email gửi đích danh người dùng sở hữu thiết bị kèm thông số môi trường và tổng giờ đã phơi.
     * Cổng 3 $\rightarrow$ `Popup Cảnh báo Mưa trên Web`: Bật thông báo khẩn màu đỏ ngay trên màn hình Dashboard.

---

### Cụm 4: Giao diện Bảng điều khiển Web Dashboard & Mô phỏng
* **Node chính:** `Giao diện Web Stitch Hiện đại (Sáng/Tối, Responsive)` (`ui_stitch_webapp`).
* **Nguyên lý hoạt động:**
  1. **Xác thực và phân quyền (F16):** Người dùng đăng nhập bằng Email/Password, quản lý phiên an toàn, tự động khóa điều khiển khi chưa đăng nhập.
  2. **Hiển thị trực quan (F17, F20):** Hiển thị các thông số thời gian thực, đồng hồ kim, biểu đồ nhiệt ẩm 24h và bảng nhật ký các phiên phơi.
  3. **Chế độ Mô phỏng (F23):** Cung cấp 3 kịch bản:
     * **☀️ Nắng ráo:** Nhiệt độ $33.5^\circ\text{C}$, Độ ẩm $58\%$, Mưa $0\%$, sào mở $90^\circ$.
     * **💧 Độ ẩm kéo dài:** Nhiệt độ $28.0^\circ\text{C}$, **Độ ẩm cao $88\%$**, Mưa $0\%$, sào mở nhưng hệ thống đưa ra khuyến nghị bật quạt đối lưu.
     * **⛈️ Mưa rào lớn:** Nhiệt độ $26.0^\circ\text{C}$, Độ ẩm $90\%$, **Mức mưa $82\%$**, lập tức thu sào $0^\circ$ và phát cảnh báo.
     * *Đặc tính an toàn:* Dữ liệu mô phỏng có cờ `is_simulation: true`, tuyệt đối không tác động servo thật và không gửi mail thật.
