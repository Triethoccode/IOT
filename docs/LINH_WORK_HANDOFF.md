# Bàn giao phần việc Trịnh Khánh Linh

Phân công đã được nhóm xác nhận: W08–W15 và phần điều khiển thiết bị của W17. Phong giữ thuật toán/cảm biến/bộ đếm, dữ liệu lịch sử và cảnh báo. Triết giữ dashboard, xác thực, biểu đồ và mô phỏng. Tài liệu này ghi nhận phần mềm và tài liệu trong repo; không xác nhận tiến độ lắp ráp hay đo kiểm thực tế.

## Đầu ra

| Việc | Đầu ra trong repo | Trạng thái |
|---|---|---|
| W08 | `hardware/layout.svg`, `hardware/DESIGN.md` | Bản bố trí danh định; cần đối chiếu linh kiện thực |
| W09 | `hardware/bom.csv` | Checklist mua/kiểm đầu vào và dự toán proposal; chưa xác nhận mua |
| W10–W11 | `hardware/DESIGN.md` | Thiết kế cơ cấu, nguồn và bảng nối; lắp ráp/đo kiểm còn lại |
| W12 | `esp32_aerodry/esp32_aerodry.ino` | Servo, ba nút chống dội 50 ms, phối hợp FSM/bộ đếm |
| W13 | Cùng firmware, `state_machine.h` | LCD 16 ký tự/dòng, quạt, đèn Auto/Manual độc lập |
| W14 | Firmware + `command_protocol.h`, `config.h` | Portal, reconnect, heartbeat/LWT, nhận lệnh, ACK |
| W17 | `nodered_data/lib/`, `nodered_data/flows.json`, `nodered_data/ui/control.js` | Kiểm tra Online, gửi lệnh, ghép ACK, timeout, trạng thái cho UI |
| W15 và phần kiểm thử W23 | `tests/`, `hardware/ACCEPTANCE.md` | Kiểm thử phần mềm tự động; checklist thử thật để trống |

## Chạy Node-RED

Từ thư mục repo:

```powershell
npm install
npm run configure:control
npm start
```

Mở `http://localhost:1880/ui`. Đăng nhập bằng tài khoản vừa cấu hình. Khi chưa nhận heartbeat thật, giao diện báo Offline và khóa điều khiển. Không có tài khoản mặc định. `configure:control` lưu email và hash scrypt trong `nodered_data/control.local.json`, được Git bỏ qua. Có thể thay bằng biến môi trường `AERODRY_CONTROL_EMAIL`, `AERODRY_CONTROL_PASSWORD_HASH`.

Adapter tài khoản cục bộ phục vụ chạy và tích hợp phần W17. Nó thay thế màn hình đăng nhập giả trước đây, nhưng **không phải Firebase Authentication W20**. Triết thay `verifyIdentity`/quản lý phiên bằng xác thực backend của mình; không nhận cờ `authenticated: true` do trình duyệt tự khai. Phiên hiện gắn với socket dashboard, hết hạn sau 1 giờ, đăng xuất chỉ xóa phiên đó, deploy flow yêu cầu đăng nhập lại. Backend giới hạn thử đăng nhập 5 lần/phút/socket.

Broker mặc định là broker public trong cấu hình cũ. Để demo riêng, đặt cùng broker cho firmware, Node-RED và cloud worker. Không thực hiện kiểm thử tự động hay phát lệnh lên broker public.

```powershell
$env:AERODRY_MQTT_HOST = '127.0.0.1' # thay bằng IP broker mà ESP32 truy cập được
$env:AERODRY_MQTT_PORT = '1883'
npm start
```

Username/password của Node-RED đặt trong MQTT broker config node qua editor; firmware dùng `config_local.h` theo file mẫu; cloud worker dùng `.env` riêng. Xác thực/TLS của broker và HTTPS web cần cấu hình theo môi trường triển khai do nhóm quản lý; không có credential hay chứng chỉ thật trong repo.

## Build firmware

Arduino ESP32 2.0.17 qua PlatformIO `espressif32@6.10.0`, ESP32Servo 0.13.0 tương thích core 2.x. Không nâng riêng ESP32Servo 3.x trong cấu hình này.

```powershell
cd esp32_aerodry
pio run
```

Không có bước upload tự động. Khi người dùng nạp và bật thiết bị, local control khởi tạo trước network task. WiFiManager chạy ở task mạng, portal timeout 120 giây; tên AP `AeroDry_Config_AP`. Gửi ký tự `P` qua Serial 115200 để mở lại portal đổi mạng, không cần sửa SSID trong source. Không xóa credential Wi-Fi bằng thao tác reset bộ đếm.

Nút, cảm biến, FSM và bộ đếm chạy trên loop task; MQTT/DNS/portal chạy trên task mạng. Heartbeat 10 giây, reconnect MQTT 5 giây, thử Wi-Fi lại 10 giây sau portal timeout. LCD đổi trang 3 giây. NTP dùng Unix UTC, không cộng lệch múi giờ vào timestamp; giao diện định dạng giờ địa phương.

## Bàn giao cho Triết: một cửa gửi lệnh

Luồng tích hợp: UI → `fn_linh_control_gateway` → MQTT → ESP32 → ACK → gateway → UI. Tất cả nút sào/chế độ/quạt/đèn/reset đi qua cùng gateway. Không nối nút trực tiếp MQTT Out.

Đầu vào dashboard có `socketid` do Node-RED Dashboard gắn:

```json
{"topic":"device_command","socketid":"server-supplied","payload":{"action":"SET_ROD","params":{"target":"RETRACTED"}}}
```

Reset yêu cầu `payload.confirmed: true` sau hộp xác nhận. Trình duyệt không gửi mã lệnh hoặc timestamp; gateway tự tạo. Các action: `SET_ROD`, `SET_MODE`, `SET_FAN`, `SET_LIGHT`, `RESET_COUNTER`, `SET_DEMO_CONFIG` (theo W01).

4 output của gateway:

1. MQTT command chuẩn, JSON string, QoS 0, retain false.
2. Phản hồi đúng `socketid`: `payload.kind=command_result`, `status=PENDING/ACCEPTED/REJECTED/EXPIRED/TIMEOUT`, `reason`, `cmd_id`, `resulting_state` nếu có.
3. Trạng thái chung `payload.kind=connection`, `online`, `last_seen_ms`, `rssi`, `ip`.
4. Dữ liệu xem thử có `is_simulation=true`, chỉ tới UI của phiên đang mô phỏng.

Mỗi thiết bị chỉ có một lệnh đang chờ. ACK timeout 5 giây; không retry lệnh tự động. TTL lệnh 5 giây, làm tròn theo Unix giây nên thời gian hiệu lực thực tế có thể ngắn hơn 5 giây. Không nhận ACK trễ/retained/sai mã/sai thiết bị/sai phiên kết nối. Timeout nghĩa là chưa xác nhận được kết quả; không khẳng định thiết bị chưa thực thi. Sau timeout, trạng thái tiếp tục đối chiếu telemetry. ACK ACCEPTED chỉ xác nhận phần mềm đã xử lý, không đo vị trí servo.

Online chỉ từ heartbeat live đúng thiết bị/nhóm; heartbeat retained ONLINE không chứng minh đang kết nối. Quá 25 giây không có heartbeat, nhận LWT OFFLINE hoặc Node-RED mất broker thì khóa điều khiển. Tick 1 giây phát hiện timeout/offline. UI cũng khóa nếu 5 giây không còn nhận trạng thái từ Node-RED.

Giao diện không tự xoay sào/đổi Auto/đếm thời gian khi bấm lệnh; chỉ cập nhật theo ACK hoặc telemetry. Không còn seed dữ liệu lịch sử khi khởi động. Các biểu đồ/CSV mẫu của thiết kế được thay bằng thông báo chờ W19; Triết nối nguồn lịch sử thật, không dùng dữ liệu cứng làm dữ liệu thật.

## Bàn giao cho Phong: MQTT

Prefix thật `aerodry/g21/esp32_01`; prefix mô phỏng `aerodry/g21/sim/esp32_01`. Các topic `telemetry`, `state`, `session`, `event`, `heartbeat`, `cmd`, `ack` theo W01. Không còn phát/nhận topic `smartdry/...` ở MQTT thật. Telemetry vẫn giữ trường phẳng để tương thích UI và trường nested cho cloud worker.

W14 bổ sung vào heartbeat: `boot_id` chuỗi ngẫu nhiên mỗi boot, `connection_id` uint32 ngẫu nhiên mỗi lần kết nối MQTT; gateway gắn cả hai vào lệnh và firmware trả cả hai trong ACK. Nhờ đó lệnh retained/đang chờ từ kết nối cũ bị từ chối sau reconnect, kể cả chưa hết TTL.

Firmware dùng parser ArduinoJson, kiểm tra schema/enum/identity/thời hạn trước khi có tác động. Chưa đồng bộ NTP thì trả `TIME_NOT_SYNCED` cho lệnh web, local control vẫn hoạt động. Cache 16 mã lệnh trong 40 giây; đầy cache thì trả `COMMAND_RATE_LIMIT` thay vì quên mã cũ và thực thi lại reset. Không xử lý lệnh có mã chứa ký tự ngoài chữ/số/`_`/`-` hoặc dài quá 47 ký tự.

Session/event dùng hàng đợi RAM 16 gói, mỗi gói tối đa 3072 byte. Chỉ bỏ gói sau publish thành công; đầy thì bỏ gói mới và log `QUEUE_FULL`. QoS 0 không đảm bảo giao hàng, mất điện mất hàng đợi. Telemetry/state chỉ giữ bản mới nhất. ACK cũ quá 5 giây bị bỏ. Không tạo dữ liệu cảm biến bù cho thời gian mất mạng.

## Kiểm thử và giới hạn

Kết quả đã chạy và phiên bản toolchain: xem `LINH_VERIFICATION.md`.

```powershell
npm test
# Sau khi pio run đã tải thư viện, nếu có MinGW g++:
powershell -NoProfile -File scripts/test-firmware.ps1 -Compiler 'C:/msys64/ucrt64/bin/g++.exe'
```

- W06 có sẵn: 8 nhóm kịch bản mô phỏng JavaScript/backend giả lập.
- Gateway: kiểm tra phiên, heartbeat, retained, TTL, ACK sai/trễ, timeout, reconnect, xác nhận reset, mô phỏng và wiring flow.
- Node-RED thật + broker test loopback: luồng login → command MQTT → ACK → đúng phiên UI → Offline chặn lệnh. Không gọi broker/cloud bên ngoài.
- Native C++: include trực tiếp parser, replay guard, FSM, bộ đếm và formatter firmware; GPIO/DHT/NVS dùng stub. Không phải kiểm thử độ bền flash hay điện áp.
- Build PlatformIO: xác nhận compile/link cho ESP32, không xác nhận thiết bị thực.

Các việc lắp ráp, mua linh kiện, hiệu chỉnh góc/ADC, đo nguồn, thử hành trình, servo thật, LCD thật, RF thực tế và nghiệm thu end-to-end với phần cứng nằm trong checklist `hardware/ACCEPTANCE.md`. Không đánh dấu hoàn thành bằng kết quả mô phỏng.
