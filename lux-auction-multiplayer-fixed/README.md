# Đấu Giá Đất & Thay Đổi Thể Chế

Web game multiplayer realtime theo nhóm, mô phỏng tích lũy coin, đấu giá đất, vai trò điều tiết của ban tổ chức và đối thoại chính sách sau đấu giá. Một phòng hỗ trợ tối đa 20 người chơi; trạng thái được giữ trong RAM của server.

## Cấu trúc thư mục

```text
lux-auction-multiplayer-fixed/
├── render.yaml                         # Render Blueprint
├── MỞ_GAME.cmd                         # Mở game nhanh trên Windows
└── lux-auction-multiplayer-fixed/
    ├── server.js                       # Express + Socket.IO + toàn bộ luật game
    ├── questions.js                    # Ngân hàng 20 câu Kinh tế chính trị
    ├── package.json
    └── client/
        ├── index.html
        ├── vite.config.js
        └── src/
            ├── main.jsx                # Giao diện React
            └── styles.css              # Giao diện luxury và animation
```

## Mở nhanh trên Windows

Nhấp đúp file `MỞ_GAME.cmd` ở thư mục ngoài cùng. Game sẽ tự cài dependency ở lần đầu, build, khởi động và mở tại `http://127.0.0.1:3000`.

Không mở trực tiếp `client/index.html`, vì đây là ứng dụng React cần chạy qua máy chủ cục bộ.

## Cài đặt

```bash
npm install
```

Nếu dùng PowerShell trên Windows và bị chặn npm.ps1, dùng:

```bash
npm.cmd install
```

## Chạy dev

```bash
npm run dev
```

Hoặc trong PowerShell:

```bash
npm.cmd run dev
```

Mở:

```text
http://127.0.0.1:5173
```

Backend health check:

```text
http://127.0.0.1:3000/api/health
```

## Chạy production

```bash
npm run build
npm start
```

Mở:

```text
http://127.0.0.1:3000
```

## Chơi cùng Wi-Fi

Lấy IPv4 của máy đang chạy server bằng:

```bash
ipconfig
```

Khi chạy chế độ dev, người chơi khác vào:

```text
http://IP_MAY_CHU:5173
```

Ví dụ:

```text
http://192.168.1.10:5173
```

Khi chạy production bằng `npm run build` và `npm start`, dùng cổng `3000` thay cho `5173`. Nếu Windows Firewall hỏi quyền truy cập, cho phép Node.js trên mạng Private.

## Đưa lên GitHub

Chạy các lệnh sau ở thư mục ngoài cùng (thay URL bằng repository của bạn):

```bash
git init
git add .
git commit -m "Build realtime quiz auction game"
git branch -M main
git remote add origin https://github.com/TEN_GITHUB/TEN_REPOSITORY.git
git push -u origin main
```

File `.gitignore` đã loại `node_modules`, bản build và tệp môi trường khỏi commit.

## Deploy lên Render

Repository đã có `render.yaml` ở thư mục ngoài cùng:

1. Đăng nhập Render và chọn **New > Blueprint**.
2. Kết nối repository GitHub vừa push.
3. Render đọc `render.yaml`, cài dependency, build React và chạy Node server.
4. Sau khi deploy xong, mở URL do Render cấp và gửi cùng một URL đó cho người chơi.

Health check dùng đường dẫn `/api/health`. Không cần tạo database. Vì trạng thái game nằm trong RAM, chỉ chạy một instance server và lưu ý rằng deploy/restart server sẽ bắt đầu lại phòng chơi.

## Luồng game

1. Người chơi nhập tên cá nhân và tên nhóm ngay khi vào sảnh; những người nhập cùng tên nhóm sẽ chơi chung.
2. Người tổ chức bắt đầu phần câu hỏi. Mỗi câu đúng cộng 100 coin vào quỹ chung của nhóm, không có hộp quà.
3. Khi mọi người hoàn thành, game tự chuyển sang 3 vòng đấu giá đất có vị trí, diện tích, mục đích sử dụng, giá khởi điểm và bonus khác nhau.
4. Trước mỗi vòng, người tổ chức chọn một thể chế mô phỏng: không can thiệp, tăng giá khởi điểm, phụ thu chuyển nhượng hoặc giới hạn sở hữu.
5. Các nhóm nói mức giá bằng lời; kế toán chọn nhóm, nhập mức giá và ghi nhận từng lượt vào sổ đấu giá của vòng.
6. Người tổ chức chốt giá thủ công. Hệ thống trừ tiền, phụ thu (nếu có) và lưu kết quả của từng lô đất.
7. Sau vòng cuối, tất cả người chơi đánh giá mức công bằng và đề xuất thay đổi chính sách/thể chế.

Danh sách `INSTITUTIONS` ở đầu `server.js` là nội dung mẫu và có thể thay trực tiếp bằng nội dung thể chế do Lâm cung cấp.
