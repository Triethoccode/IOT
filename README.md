# AeroDry IoT (SmartBreeze Pro) – Hệ Thống Giàn Phơi Thông Minh

**Nhóm 21 – Lớp 24C11 | Học phần: Vật lý cho Công nghệ Thông tin (PHY00007)**  
- **Tạ Bỉnh Phong (24127100 – Nhóm trưởng):** Cảm biến, thuật toán tự động hóa, bộ đếm thời gian phơi trên ESP32 (**W01–W06**), Lưu trữ Cloud Firestore (**W18**), Truy vấn lịch sử 24 giờ (**W19 - phần dữ liệu**), Thông báo đẩy PushSafer & Email SMTP chống gửi trùng (**W21**).
- **Trịnh Khánh Linh (24127437):** Cơ cấu cơ khí, mạch nguồn, điều khiển Servo & 3 nút nhấn (**W12**), LCD1602 I2C, Relay quạt & Đèn LED (**W13**), WiFiManager portal & MQTT (**W14**).
- **Trần Minh Triết (24127573):** Giao diện Web Dashboard (Stitch UI / Node-RED Dashboard) (**W16**), Backend điều khiển (**W17**), Vẽ biểu đồ 24 giờ & hiển thị nhật ký (**W19 - phần UI**), Đăng nhập/Đăng xuất (**W20**), Chế độ mô phỏng (**W22**).

---

## 1. Cấu Trúc Thư Mục Toàn Dự Án (`d:\projects\IOT`)

```text
d:\projects\IOT\
├── docs/
│   └── W01_MQTT_And_StateMachine_Spec.md      # [W01 - Phong] Đặc tả quy tắc Auto/Manual, Ngưỡng trễ & Hợp đồng JSON MQTT
├── esp32_aerodry/                             # [W01–W05 (Phong) + W12–W14 (Linh)] Mã nguồn Firmware ESP32 (Arduino / PlatformIO)
│   ├── platformio.ini                         # Cấu hình thư viện cho PlatformIO / Arduino IDE
│   ├── esp32_aerodry.ino                      # Chương trình chính ESP32 (ghép cảm biến, FSM, bộ đếm, LCD, Servo, Nút nhấn, MQTT)
│   ├── config.h                               # Cấu hình chân GPIO, ngưỡng Bảng 3.1, thời gian chờ khô (180s / 10s demo), MQTT topics
│   ├── types.h                                # Kiểu dữ liệu, enum trạng thái, nguyên nhân thu sào, cấu trúc bản tin
│   ├── sensors.h                              # [W02, W03 - Phong] Đọc DHT11 (cờ lỗi, không gán số giả), LDR (ngưỡng trễ), Mưa (ADC -> % ướt)
│   ├── drying_tracker.h                       # [W04 - Phong] Mẻ đồ (batch_id), phiên phơi (session_id), cộng dồn, reset, lưu NVS & mất điện
│   ├── state_machine.h                        # [W03, W05 - Phong] Máy trạng thái Auto/Manual, đếm xác nhận khô, cảnh báo mưa/ẩm cao, chạy Offline
│   └── mqtt_contract.h                        # [W01, W05 - Phong] Đóng gói JSON MQTT & hàng đợi RAM khi mất mạng (Offline Queue)
├── backend_cloud_notify/                      # [W18, W19-Phong, W21] Dịch vụ Cloud Firestore, Truy vấn lịch sử 24h & Cảnh báo PushSafer/SMTP
│   ├── package.json                           # Khai báo thư viện (firebase-admin, mqtt, nodemailer, dotenv)
│   ├── .env.example                           # Mẫu cấu hình khóa Firebase, PushSafer API Key và tài khoản Gmail SMTP
│   ├── firestore.rules                        # [W18 - Phong] Quy tắc bảo mật Firestore (chặn ghi giả lập, kiểm tra quyền đăng nhập)
│   ├── firestore.indexes.json                 # [W18 - Phong] Cấu hình chỉ mục truy vấn lịch sử 24 giờ
│   ├── src/
│   │   ├── config.js                          # Cấu hình chu kỳ lưu mẫu 60s, cooldown chống gửi trùng 15 phút & retry
│   │   ├── firestoreService.js                # [W18 - Phong] Bộ lọc 60s lưu sensor_samples, lưu batches, drying_sessions & events
│   │   ├── historyQueryService.js             # [W19 - Phong] Truy vấn lịch sử 24h & phát hiện khoảng trống mất mạng (không tự bịa dữ liệu bù)
│   │   ├── notificationService.js             # [W21 - Phong] Gửi PushSafer & Email SMTP, chống gửi trùng (cooldown) & retry tối đa 3 lần
│   │   ├── mqttWorker.js                      # [W18, W21 - Phong] Lắng nghe MQTT từ ESP32 -> lưu Firestore & phát cảnh báo
│   │   └── index.js                           # Khởi chạy dịch vụ độc lập & cung cấp API GET /api/history/24h cho UI của Triết
│   └── nodered/
│       └── aerodry_phong_flows.json           # Luồng Node-RED đóng gói riêng phần W18, W19, W21 để import nhanh
├── nodered_data/                              # [W16–W22] Node-RED Backend & Giao diện Web Dashboard (đã tích hợp W18, W19, W20, W21)
│   ├── flows.json                             # Luồng chính chạy Web Dashboard tại http://localhost:1880/ui
│   └── settings.js                            # Cấu hình máy chủ Node-RED
├── UI_Stitch/                                 # Bản thiết kế HTML độc lập của giao diện Đăng nhập & Bảng điều khiển (Triết)
├── tests/
│   └── run_w06_verification.js                # [W06 - Phong] Kịch bản kiểm thử tự động toàn bộ ma trận Bảng 5.5
└── package.json                               # Script khởi chạy nhanh Node-RED Dashboard & bộ kiểm thử W06
```

---

## 2. Hướng Dẫn Chạy Và Kiểm Thử Nhanh

### A. Chạy Kiểm Thử Tự Động W06 (Đối chiếu toàn bộ kịch bản Bảng 5.5)
```powershell
node tests/run_w06_verification.js
```

### B. Chạy Giao Diện Web Dashboard & Node-RED Backend (Tích hợp UI của Triết + Logic của Phong)
```powershell
npm install
npm start
```
- **Giao diện người dùng (Web Dashboard):** `http://localhost:1880/ui`
- **Giao diện chỉnh sửa luồng Node-RED:** `http://localhost:1880`

### C. Nạp Code Lên Mạch ESP32 (`esp32_aerodry/`)
1. **Cách 1 (Arduino IDE):** Mở file `esp32_aerodry/esp32_aerodry.ino` bằng Arduino IDE, cài các thư viện `DHT sensor library`, `PubSubClient`, `ESP32Servo`, `LiquidCrystal_I2C`, `WiFiManager`, chọn board `ESP32 Dev Module` và nhấn **Upload**.
2. **Cách 2 (PlatformIO trên VS Code):** Mở thư mục `esp32_aerodry/`, PlatformIO sẽ tự động tải đúng phiên bản thư viện trong `platformio.ini` và biên dịch.
