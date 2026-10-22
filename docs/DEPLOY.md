# Triển khai TaskPilot

## Chạy bằng systemd

Dùng Linux có systemd và hoàn tất [yêu cầu cài đặt](../README.md#yêu-cầu). Trong thư mục TaskPilot, tạo `.env` nếu chưa có:

```bash
cp .env.example .env
chmod 600 .env
```

Chỉnh biến cần dùng theo [Cấu hình](CONFIGURATION.md#biến-môi-trường), rồi:

```bash
make service-install    # Build, tạo user service và khởi động
make service-status
make service-logs
```

Service dùng tài khoản hiện tại để truy cập cấu hình và đăng nhập CLI của bạn. Đường dẫn `node`, `claude`, `copilot` được ghi nhận lúc cài; chạy lại `make service-install` nếu đổi bản Node hoặc vị trí CLI.

Sau khi cập nhật mã nguồn hoặc `.env`, chạy `make service-restart`. Các phiên CLI đang chạy sẽ dừng; tiếp tục từ giao diện. `make service-uninstall` gỡ service. Muốn service tồn tại sau khi đăng xuất, bật lingering bằng `loginctl enable-linger "$USER"`.

## Reverse proxy

Cấu hình proxy chuyển HTTP và WebSocket tới TaskPilot, đồng thời truyền luồng SSE không bị giữ đệm. Giữ hostname hợp lệ trong `Host` và gửi `X-Forwarded-Proto: https` nếu proxy kết thúc TLS. Đặt domain trong `TASKPILOT_ALLOWED_HOSTS` và bật `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` khi cho truy cập từ bên ngoài máy.

Nếu proxy chạy trong Docker, có thể cho TaskPilot lắng nghe địa chỉ bridge của host, ví dụ `TASKPILOT_HOST=172.17.0.1`, rồi proxy tới `http://host.docker.internal:8790`. Kiểm tra địa chỉ bridge và cách phân giải `host.docker.internal` trên máy triển khai. Hook gọi thẳng vào địa chỉ lắng nghe nên proxy có thể chặn `/hook/`.

## Xác thực và quyền truy cập

Terminal cho phép chạy lệnh với quyền của tài khoản đang chạy TaskPilot. Chỉ cấp truy cập cho người được phép dùng tài khoản đó.

- Mặc định lắng nghe `127.0.0.1`; kiểm tra `Host` / `Origin` theo loopback, địa chỉ lắng nghe và `TASKPILOT_ALLOWED_HOSTS`.
- Không đặt tài khoản: URL khởi động chứa token đăng nhập, ngẫu nhiên mỗi lần chạy hoặc cố định bằng `TASKPILOT_TOKEN`.
- Có tài khoản: dùng màn hình đăng nhập. Nếu đặt thêm `TASKPILOT_TOKEN`, script có thể gọi API qua header `x-taskpilot-token`.
- API riêng tư, SSE và WebSocket yêu cầu xác thực. Phiên trình duyệt dùng cookie `HttpOnly`, `SameSite=Strict`, có `Secure` khi kết nối được nhận diện là HTTPS; hiệu lực 7 ngày. Dữ liệu phiên lưu dạng băm trong thư mục trạng thái.
- Đổi thông tin đăng nhập hoặc token đăng nhập sẽ vô hiệu hóa phiên cũ. Năm lần đăng nhập sai khóa địa chỉ kết nối 15 phút; sau proxy, nhiều người có thể chung giới hạn này.
- Hook CLI dùng token riêng theo tiến trình phiên, tách với token đăng nhập.
