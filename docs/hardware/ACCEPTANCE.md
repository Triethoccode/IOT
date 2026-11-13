# W15 và phối hợp W23: nghiệm thu thực tế

Người thực hiện: ______. Ngày: ______. Commit firmware/flow: ______.
Board/servo/relay/LCD/nguồn thực: ______. Tải vải demo: ______.

Các ô trống là **chưa thực hiện**, không suy ra PASS từ test phần mềm.

| ID | Thao tác | Kết quả cần đạt | Đo/log/ảnh | PASS/FAIL |
|---|---|---|---|---|
| H01 | Kiểm tra bảng dây và chân | Khớp config.h; không ngắn mạch, đúng mức tín hiệu | | |
| H02 | Đo nguồn chưa tải và khi servo/quạt khởi động | 5 V/3,3 V phù hợp module; ESP32 không brownout/reset | | |
| H03 | Boot khi nút nhả và khi giữ từng nút | Boot ổn định; quạt mặc định tắt; xử lý chân boot đúng | | |
| H04 | Hiệu chỉnh thu/mở với móc và vải demo | Không ép chặn, va chạm, kéo dây; ghi góc thực tế | | |
| H05 | Nhấn/giữ/nhả ba nút | Một hành động mỗi lần nhấn; không dội; reset đúng mẻ | | |
| H06 | Đưa ra khi quạt đang bật | Relay tắt trước tín hiệu servo; web từ chối bật quạt khi sào ngoài | | |
| H07 | LCD: lỗi DHT, nhiều giờ phơi, chuyển trang | Mỗi dòng đủ 16 ký tự; không còn ký tự trang trước | | |
| H08 | Đổi sáng/tối; chọn đèn Manual rồi Auto | Manual không bị LDR ghi đè; không ảnh hưởng chế độ sào | | |
| H09 | Portal lúc chưa có Wi-Fi; Serial P đổi mạng | Cấu hình được; timeout 120s; nút/cảm biến vẫn chạy | | |
| H10 | Mất Wi-Fi/broker lúc đang chạy | Local vẫn chạy; dashboard khóa sau mất kết nối; không báo thành công giả | | |
| H11 | Kết nối lại; thử lệnh cũ | Chỉ gửi lệnh mới; không thực thi lệnh từ connection_id cũ | | |
| H12 | Web Thu → MQTT → ACK | Đang gửi rồi đã tiếp nhận đúng cmd_id; quan sát servo riêng | | |
| H13 | Mất ACK, ACK sai mã và ACK trễ | Báo timeout; không retry; không nhận thành công giả | | |
| H14 | Reset khi đang phơi; gửi lại cùng cmd_id | Mẻ mới đếm lại; giữ lịch sử; không reset hai lần | | |
| H15 | Đang Auto phơi, làm ướt tấm mưa | Thu, đóng phiên, ghi telemetry; phối hợp Phong kiểm tra cảnh báo | | |
| H16 | Dao động ngưỡng / chờ khô chuẩn và demo | Không đóng mở lặp; chờ đủ 180s/10s; web ghi rõ demo | | |
| H17 | Bật mô phỏng rồi thử điều khiển thật | Không publish cmd thật; không ghi cloud hoặc gửi cảnh báo thật | | |
| H18 | Đăng xuất / chưa đăng nhập | Backend từ chối mọi nút; phiên người khác không bị cấp quyền | | |
| H19 | Đóng/mở lặp với tải demo | Ghi số lần; nhiệt/nguồn/gá/dây ổn định theo quan sát | | |
| H20 | Mất điện giữa phiên rồi bật lại | Không cộng thời gian mất điện; phát hiện gián đoạn; đối chiếu cloud với Phong | | |

Ghi số đo và video/log; không ghi “servo đã đến đích” chỉ dựa trên ACK. Không có cảm biến hành trình trong cấu hình hiện tại.
