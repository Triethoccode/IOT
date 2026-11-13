# Kết quả kiểm tra phần Linh — 13/11/2026

Kiểm tra trên workspace IOT sau khi triển khai W12–W14 và phần điều khiển W17. Chưa nạp firmware hoặc thực hiện phép đo phần cứng.

| Kiểm tra | Kết quả | Phạm vi |
|---|---|---|
| PlatformIO `esp32dev` | PASS | Compile/link firmware ESP32, tạo firmware.bin |
| W06 có sẵn | 8 nhóm PASS | Mô phỏng JavaScript, backend giả lập |
| Gateway Node.js | 14/14 PASS | Xác thực phiên, heartbeat, TTL, ACK, timeout, replay phiên kết nối, mô phỏng, wiring |
| UI control | 2/2 PASS | Chờ xác thực/ACK, không báo thành công giả, xác nhận reset, khóa mô phỏng |
| Node-RED + MQTT loopback | 1/1 PASS | Flow thật gửi MQTT QoS 0/no-retain, nhận ACK, trả đúng socket, chặn khi Offline |
| C++ native | PASS | Mã firmware thật: chống dội/rollover, LCD, parser, cache lệnh, FSM/bộ đếm, telemetry/ACK và 8 loại event UTF-8 |
| PowerShell scripts | PASS | Parse cú pháp cả hai script; chạy script native test thành công |
| Sinh lại flow | PASS | Build lặp cho cùng JSON, không thay đổi ngoài ý muốn |
| `git diff --check` | PASS | Không lỗi whitespace; có cảnh báo quy đổi LF/CRLF theo Git trên Windows |
| SVG bố trí | Đã render và xem | Bố trí danh định, không xác minh kích thước cơ khí thực |
| BOM | Tổng 800.000đ | Khớp dự toán proposal, không phải giá mua hiện tại |

Build sử dụng PlatformIO 6.2.0, platform espressif32 6.10.0, Arduino ESP32 2.0.17, ArduinoJson 7.4.3, ESP32Servo 0.13.0. Static RAM: 66.396/327.680 byte (20,3%); flash: 960.253/1.310.720 byte (73,3%). Số RAM tĩnh không bao gồm heap cấp cho queue/task lúc chạy.

Tổng Node.js: **17 test PASS**, bên cạnh 8 nhóm W06. Test C++ dùng stub GPIO/DHT/NVS; test broker là server loopback phục vụ kiểm thử, không phải broker để triển khai. Không có thông báo Pushsafer/email thật được gửi bởi các kiểm thử này.

Lệnh tái chạy:

```powershell
npm test
powershell -NoProfile -File scripts/test-firmware.ps1 -Compiler 'C:/msys64/ucrt64/bin/g++.exe'
cd esp32_aerodry
pio run
```

Phần thử thực tế còn lại ở `hardware/ACCEPTANCE.md`. Credentials broker, Firebase Auth W20, cloud và HTTPS triển khai do nhóm cấu hình riêng; tài khoản demo W17 được tạo bằng `npm run configure:control`. Không suy ra toàn bộ hệ thống đã nghiệm thu chỉ từ bảng trên.
