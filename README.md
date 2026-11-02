# AeroDry IoT (SmartBreeze Pro) — Hệ thống Giàn phơi & Sấy gió Thông minh

Dự án hệ thống giàn phơi quần áo tự động tích hợp theo dõi thời gian phơi thực tế, điều khiển động cơ đóng/mở giàn phơi, quạt sấy gió đối lưu và giao diện quản lý Web Dashboard hiện đại (hỗ trợ chế độ **Sáng / Tối** và **Responsive** đa thiết bị).

---

## 1. Cấu trúc thư mục dự án

```text
Project/
├── nodered_data/
│   ├── flows.json              # Luồng xử lý Backend Node-RED & Giao diện Web Dashboard chính
│   └── settings.js             # Cấu hình máy chủ Node-RED
├── UI_Stitch/
│   ├── Login Page/
│   │   ├── code.html           # Giao diện Màn hình Đăng nhập (Bản HTML độc lập)
│   │   └── DESIGN.md           # Đặc tả hệ thống thiết kế (Design System)
│   └── GiaoDienChinh/
│       ├── code.html           # Giao diện Bảng điều khiển trung tâm (Bản HTML độc lập)
│       └── DESIGN.md           # Đặc tả hệ thống thiết kế (Design System)
├── HUONG_DAN_NODE_RED.md       # Giải thích chi tiết sơ đồ nối dây các Node trong Node-RED
├── Proposal.docx               # Báo cáo thuyết minh đề tài & Mã nguồn vi điều khiển ESP32
├── package.json                # Cấu hình thư viện Node-RED & script khởi chạy
└── README.md                   # Hướng dẫn cài đặt và khởi chạy dự án
```

---

## 2. Yêu cầu hệ thống (Prerequisites)

* **Node.js**: Phiên bản `v18.x` trở lên (khuyến nghị `v20+` hoặc `v22+`).
* **Trình quản lý gói**: `npm` (đi kèm khi cài đặt Node.js).
* Kiểm tra nhanh trong Terminal / PowerShell:
  ```bash
  node -v
  npm -v
  ```

---

## 3. Hướng dẫn cài đặt và chạy dự án (Quick Start)

### Bước 1: Clone kho lưu trữ (Repository) về máy
```bash
git clone <URL_REPO_CUA_BAN>
cd Project
```

### Bước 2: Cài đặt thư viện (Dependencies)
Chạy lệnh sau tại thư mục gốc của dự án để cài đặt `node-red` và `node-red-dashboard`:
```bash
npm install
```

### Bước 3: Khởi động hệ thống Web & Node-RED Backend
```bash
npm start
```
*(Lệnh này tương đương với `npx node-red --userDir ./nodered_data flows.json`)*

### Bước 4: Truy cập giao diện trên trình duyệt
Sau khi Terminal báo `Server now running at http://127.0.0.1:1880/`, bạn mở trình duyệt truy cập:

1. **Giao diện Website Người dùng (Web Dashboard)**:
   * 👉 **[http://localhost:1880/ui](http://localhost:1880/ui)**
   * Tính năng trên giao diện:
     * Chuyển đổi giao diện **Sáng / Tối** ở góc trên bên phải.
     * Chuyển đổi **Màn hình Đăng nhập** $\leftrightarrow$ **Bảng điều khiển trung tâm** (qua nút *Đăng nhập* / *Đăng xuất*).
     * Điều khiển **Đẩy sào ra phơi (90°)**, **Thu sào vào mái hiên (0°)**, **Đặt lại bộ đếm giờ phơi**.
     * Bật/tắt **Quạt sấy gió**, **Đèn ban công**, **Tự động theo thời tiết**.
     * Nút thử nghiệm nhanh 3 kịch bản thời tiết: **☀️ Nắng ráo**, **🌦️ Mưa nhỏ**, **⛈️ Mưa lớn**.
     * Xem **Thống kê 24 Giờ** (*Nhiệt độ & Độ ẩm*, *Thời lượng các đợt phơi*) và tải báo cáo **Xuất CSV**.

2. **Giao diện Sơ đồ Luồng Node-RED (Flow Editor dành cho kỹ thuật)**:
   * 👉 **[http://localhost:1880](http://localhost:1880)**

3. **Xem nhanh giao diện HTML độc lập (Không cần bật Server)**:
   * Mở trực tiếp file [`UI_Stitch/Login Page/code.html`](./UI_Stitch/Login%20Page/code.html) hoặc [`UI_Stitch/GiaoDienChinh/code.html`](./UI_Stitch/GiaoDienChinh/code.html) bằng trình duyệt bất kỳ.

---

## 4. Xử lý sự cố thường gặp (Troubleshooting)

* **Lỗi cổng `1880` đang được sử dụng (`EADDRINUSE: address already in use 0.0.0.0:1880`)**:
  * Nghĩa là Node-RED đã được bật từ trước đó. Bạn có thể mở thẳng `http://localhost:1880/ui` hoặc tắt tiến trình cũ bằng lệnh:
    ```powershell
    Stop-Process -Name "node" -Force
    npm start
    ```
* **Giao diện chưa cập nhật sau khi sửa `flows.json`**:
  * Nhấn tổ hợp phím **`Ctrl + F5`** trên trình duyệt để làm mới bộ nhớ đệm (Cache).
