# Đấu Giá Đất Theo Nhóm

Web game multiplayer realtime theo nhóm, gồm phần tích lũy coin, 5 vòng đấu giá đất và lật ô nhận kết quả bí mật. Một phòng hỗ trợ tối đa 20 người chơi; trạng thái được giữ trong RAM của server.

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

1. Người tổ chức chọn **Admin tổ chức**, tạo tài khoản Admin và nhận mã phòng gồm 6 ký tự. Admin có quyền bắt đầu trò chơi, chuyển sang đấu giá, mở/chốt vòng, lật ô đất, mở phiên mới và kết thúc phòng.
2. Người chơi nhập mã phòng và tên nhóm để tham gia. Tài khoản người chơi chỉ được trả lời câu hỏi lấy coin và bấm Space giành quyền ra giá; máy chủ từ chối mọi lệnh quản trị từ người chơi.
3. Admin bắt đầu phần câu hỏi. Mỗi câu đúng cộng 100 coin vào quỹ chung của nhóm, không có hộp quà.
4. Khi mọi người hoàn thành, game tự chuyển sang 5 vòng đấu giá đất có vị trí, diện tích, mục đích sử dụng, giá khởi điểm và bonus khác nhau.
5. Admin mở vòng; mọi nhóm được bấm Space liên tục để giành quyền nói mức giá. Nhóm vừa bấm gần nhất được hiển thị cho đến khi Admin chốt vòng; hệ thống không trừ coin.
6. Sau vòng thứ 5, màn hình hiện 5 ô đất úp. Chỉ Admin có quyền lật; kết quả được xáo ngẫu nhiên gồm: 5 điểm, 1 điểm, hai phần quà và một hình phạt.
