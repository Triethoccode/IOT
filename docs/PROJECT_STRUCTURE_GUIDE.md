# CẨM NANG BÁO CÁO: ĐẶC TẢ KIẾN TRÚC & CẤU TRÚC HỆ THỐNG AERODRY IoT
## HỆ THỐNG GIÀN PHƠI THÔNG MINH (SMARTBREEZE PRO)
**Môn học:** Vật lý cho Công nghệ Thông tin (PHY00007) – Lớp 24C11 – Nhóm 21  
**Đơn vị:** Trường Đại học Khoa học Tự nhiên – ĐHQG-HCM  
**Phiên bản chuẩn hóa nộp bài:** Tháng 11/2026

---

## 1. CẤU TRÚC MÃ NGUỒN CHUẨN ĐỒ ÁN (SUBMISSION REPOSITORY STRUCTURE)

Dưới đây là cấu trúc thư mục hoàn chỉnh, tinh gọn và chuẩn mực nhất của toàn bộ hệ thống đồ án AeroDry IoT để trình bày và nộp cho Hội đồng / Giảng viên:

```text
D:\III_HK1\VL\Project/
├── esp32_aerodry/                 <--- [TẦNG PHẦN CỨNG] Toàn bộ mã nguồn C++ nhúng nạp vào mạch ESP32
│   ├── esp32_aerodry.ino          <--- Chương trình chính (Vòng lặp setup/loop, điều khiển Servo, Quạt, LED)
│   ├── sensors.h                  <--- Module đọc cảm biến DHT11, cảm biến mưa ADC, quang trở LDR
│   ├── state_machine.h            <--- Bộ máy trạng thái hữu hạn FSM (Auto / Manual / Chờ khô 180s)
│   ├── drying_tracker.h           <--- Bộ đếm thời gian phơi cộng dồn & quản lý mẻ đồ
│   ├── mqtt_contract.h            <--- Khung định dạng bản tin chuẩn MQTT (Telemetry, Ack, Event, Heartbeat)
│   ├── command_protocol.h         <--- Giao thức nhận lệnh điều khiển an toàn từ Web
│   ├── local_io.h                 <--- Xử lý 3 nút nhấn vật lý chống dội (Debounce 50ms)
│   └── config.h                   <--- Cấu hình chân GPIO phần cứng & địa chỉ Broker HiveMQ
│
├── nodered_data/                  <--- [TẦNG TRUNG TÂM] TOÀN BỘ BACKEND, GATEWAY & GIAO DIỆN WEB
│   ├── flows.json                 <--- [TRÁI TIM HỆ THỐNG] Toàn bộ 5 Cụm chức năng Node-RED & Web Dashboard
│   ├── settings.js                <--- Cấu hình khởi động Node-RED, nạp biến môi trường & Module Gateway
│   ├── firebase_key.json          <--- Chìa khóa xác thực bảo mật (Service Account) của Google Cloud Firestore
│   ├── control.local.json         <--- Danh bạ phân quyền tài khoản & mã hóa mật khẩu an toàn (scrypt)
│   └── lib/                       <--- Các module lõi trung tâm của Backend:
│       ├── control-gateway.js     <--- Cổng Gateway điều khiển, cấp mã phiên (Session), so khớp ACK & Timeout 5s
│       └── route-message.js       <--- Bộ định tuyến gói tin giữa Web Dashboard và Broker MQTT
│
├── docs/                          <--- [HỒ SƠ KỸ THUẬT] Toàn bộ tài liệu báo cáo & thiết kế
│   ├── PROJECT_STRUCTURE_GUIDE.md <--- Cẩm nang kiến trúc hệ thống chuẩn nộp bài (Tài liệu này)
│   ├── NODE_RED_FUNCTIONS_EXPLAINED.md <--- Đặc tả chi tiết từng biến và giải thuật trong Function Nodes
│   └── hardware/                  <--- Hồ sơ phần cứng (Bản vẽ mạch layout.svg, linh kiện bom.csv, DESIGN.md)
│
├── package.json                   <--- File quản lý dự án & Lệnh vận hành hệ thống (npm start)
├── .gitignore                     <--- Quy tắc bảo mật (loại bỏ các file tạm, bảo vệ file khóa)
└── README.md                      <--- Hướng dẫn giới thiệu tổng quan đồ án Nhóm 21
```

---

## 2. KIẾN TRÚC HỆ THỐNG 3 TẦNG (THREE-TIER ARCHITECTURE)

Hệ thống được thiết kế theo đúng chuẩn kiến trúc IoT công nghiệp gồm 3 tầng khép kín:

```mermaid
flowchart TD
    subgraph TIER1["TẦNG 1: THIẾT BỊ ĐẦU CUỐI & ĐIỀU KHIỂN BIÊN (esp32_aerodry/)"]
        SENS["Cảm biến môi trường:<br/>DHT11, Mưa ADC, LDR"]
        FSM["Bộ não xử lý tại chỗ:<br/>FSM (state_machine.h) & Bộ đếm phơi (drying_tracker.h)"]
        ACT["Cơ cấu chấp hành:<br/>Servo sào (0°-90°), Quạt sấy, Đèn LED, LCD1602"]
        SENS --> FSM --> ACT
    end

    subgraph BROKER["TRUYỀN THÔNG TRUNG GIAN (MQTT BROKER)"]
        MQTT_SV["HiveMQ Public Cloud Broker<br/>(broker.hivemq.com:1883)<br/>Namespace: aerodry/g21/esp32_01/..."]
    end

    subgraph TIER2["TẦNG 2: MÁY CHỦ TRUNG TÂM (nodered_data/ - Port 1880)"]
        NR_GW["IoT Control Gateway & Bảo mật Scrypt<br/>(control-gateway.js & settings.js)"]
        NR_FLOW["Xử lý nghiệp vụ & Bộ lọc 60s<br/>(Function Nodes trong flows.json)"]
        REST_API["Cổng REST API Lịch sử 24h<br/>(GET /api/history/24h)"]
        FE_UI["Giao diện Bảng điều khiển Web Hiện đại<br/>(HTML5/CSS3 Stitch UI Dashboard)"]
        
        NR_GW <--> NR_FLOW
        NR_FLOW <--> REST_API
        NR_FLOW <--> FE_UI
    end

    subgraph TIER3["TẦNG 3: DỊCH VỤ ĐÁM MÂY & BÁO ĐỘNG NGƯỜI DÙNG"]
        CLOUD_DB[("Google Cloud Firestore<br/>(sensor_samples, batches, events)")]
        PUSH_NOTIFY["Dịch vụ Báo động Khẩn cấp:<br/>PushSafer Notification & Gmail SMTP"]
    end

    %% Dòng chảy dữ liệu
    TIER1 <-->|WiFi 2.4GHz / MQTT Protocol| BROKER
    BROKER <-->|TCP Socket / Port 1883| TIER2
    TIER2 -.->|Google Service Key| CLOUD_DB
    TIER2 -.->|HTTPS API / SMTP| PUSH_NOTIFY
```

---

## 3. BẢN ĐỒ 5 CỤM CHỨC NĂNG TRÊN GIAO DIỆN NODE-RED (`flows.json`)

Toàn bộ hệ thống Backend và Frontend được tổ chức cực kỳ khoa học thành **5 Cụm chức năng độc lập** trên màn hình Node-RED Editor:

```mermaid
flowchart TD
    C1["CỤM 1: THU THẬP CẢM BIẾN & LỌC 60s CLOUD (Uplink)<br/>- Hứng telemetry 2.5s từ ESP32<br/>- Kiểm tra cảm biến DHT11 (dhtValid)<br/>- Bắt sự kiện đóng/mở sào để tính giờ phơi<br/>- Bộ lọc chu kỳ 60s chuẩn bị mẫu lưu Cloud Firestore"]
    
    C4["CỤM 2: MÀN HÌNH ĐĂNG NHẬP & WEB DASHBOARD<br/>- Giao diện Stitch UI Sáng/Tối, Responsive trên mọi thiết bị<br/>- Đồng hồ kim Nhiệt độ, Độ ẩm, Mưa, Trạng thái sào<br/>- Cụm 3 nút kịch bản thử nghiệm: Nắng ráo, Ẩm kéo dài, Mưa lớn"]

    C2["CỤM 3: ĐIỀU KHIỂN THIẾT BỊ & GATEWAY LỆNH (Downlink)<br/>- Xác thực phiên làm việc an toàn chống can thiệp trái phép<br/>- Giám sát nhịp tim sống/còn Heartbeat 5s (báo Online/Offline)<br/>- Cấp mã cmd_id ngẫu nhiên có thời hạn (TTL = 5s)<br/>- So khớp bản tin xác nhận ACK từ ESP32 trước khi báo thành công"]

    C3["CỤM 4: CẢNH BÁO MƯA KHẨN CẤP & THÔNG BÁO TỨC THỜI<br/>- Cơ chế Cooldown 15 phút chống spam hộp thư<br/>- Tự động tạo nội dung cảnh báo chi tiết mẻ đồ đã phơi bao lâu<br/>- Bắn thông báo đẩy PushSafer trực tiếp qua HTTP Request Node<br/>- Bật Popup cảnh báo màu đỏ tức thì trên màn hình Web"]

    C5["CỤM 5: CỔNG REST API TRUY VẤN LỊCH SỬ 24H (HTTP Endpoint)<br/>- Điểm cuối: GET /api/history/24h (trực tiếp trên cổng 1880)<br/>- Trả về JSON chuẩn: Danh sách mẫu 24h, mẻ đồ và các sự kiện mưa<br/>- Phục vụ vẽ đồ thị và kết nối ứng dụng bên ngoài"]

    C1 --> C4 --> C2 --> C3 --> C5
```

---

## 4. CHI TIẾT CÁC ĐƯỜNG ỐNG TRUYỀN THÔNG (MQTT TOPIC CONTRACT)

Dự án sử dụng cơ chế định danh độc nhất trên máy chủ **HiveMQ Cloud** để đảm bảo không bị xung đột với các hệ thống khác:

| Tên Topic MQTT | Hướng truyền | Chức năng nghiệp vụ | Chu kỳ / Điều kiện kích hoạt |
| :--- | :---: | :--- | :--- |
| **`aerodry/g21/esp32_01/telemetry`** | ESP32 $\rightarrow$ Node-RED | Dữ liệu đo cảm biến (Nhiệt, Ẩm, Mưa, Vị trí sào, Giây phơi) | Định kỳ **2.5 giây/lần** (QoS 0). |
| **`aerodry/g21/esp32_01/heartbeat`** | ESP32 $\rightarrow$ Node-RED | Điểm danh nhịp tim sống còn (Online/Offline) | Định kỳ **5.0 giây/lần** (Quá 25s không có $\rightarrow$ Báo Mất mạng). |
| **`aerodry/g21/esp32_01/cmd`** | Node-RED $\rightarrow$ ESP32 | Gửi lệnh điều khiển (Đẩy sào, Thu sào, Quạt, Đèn, Reset) | Kích hoạt khi người dùng bấm nút trên Web Dashboard. |
| **`aerodry/g21/esp32_01/ack`** | ESP32 $\rightarrow$ Node-RED | Xác nhận phần cứng đã chấp hành xong lệnh điều khiển | Gửi phản hồi ngay sau khi Servo/Relay thực thi xong. |
| **`aerodry/g21/esp32_01/event`** | ESP32 $\rightarrow$ Node-RED | Bắn sự kiện thời tiết bất thường (Mưa lớn, Độ ẩm cao kéo dài) | Kích hoạt tức thì khi cảm biến nước phát hiện mưa. |

---

## 5. HƯỚNG DẪN VẬN HÀNH DỰ ÁN KHI DEMO VÀ NỘP BÀI

Toàn bộ hệ sinh thái đã được tinh gọn và đồng bộ hóa cao độ:

1. **Khởi động duy nhất một lệnh:**
   Mở terminal tại thư mục gốc và chạy:
   ```bash
   npm start
   ```
2. **Truy cập các cổng giao tiếp:**
   * **Bảng điều khiển Web Dashboard:** [http://127.0.0.1:1880/ui](http://127.0.0.1:1880/ui) *(Giao diện người dùng)*
   * **Trình soạn thảo trực quan Node-RED:** [http://127.0.0.1:1880](http://127.0.0.1:1880) *(Sơ đồ 5 cụm flow)*
   * **Cổng REST API Lịch sử 24h:** [http://127.0.0.1:1880/api/history/24h](http://127.0.0.1:1880/api/history/24h) *(Trả về JSON dữ liệu)*
