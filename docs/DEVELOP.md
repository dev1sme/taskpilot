# Phát triển TaskPilot

## Chạy môi trường dev

Cài [các yêu cầu](../README.md#yêu-cầu), chạy `npm ci` tại gốc repo, rồi mở hai terminal:

```bash
npm run dev:server   # API: 127.0.0.1:8791, token dev
npm run dev:client   # Giao diện: http://127.0.0.1:5173/?token=dev
```

Có thể chạy cả hai bằng `make dev`. Nếu `.env` đặt tài khoản đăng nhập, dùng tài khoản đó thay cho token `dev`. Cổng dev tách khỏi cổng service `8790`.

## Kiểm tra

Chạy các kiểm tra phù hợp trước khi gửi thay đổi:

```bash
npm test                 # Unit test, quy tắc kiến trúc và chuỗi giao diện
npm run typecheck        # TypeScript server và client
npm run i18n:lint        # Chuỗi JSX cần đưa vào tài nguyên dịch
npm run lint             # Quy tắc React hooks (ESLint)
npm run format:check     # Định dạng Prettier
npm run build            # Build giao diện và server
```

Chạy `npm run format` để sửa định dạng.

E2E dùng Playwright, cần cài bộ phụ thuộc riêng và Chromium. Chạy từ gốc repo:

```bash
npm --prefix e2e ci
(cd e2e && npx playwright install chromium)
npm run e2e
```

Bộ E2E tự mở server và client trên cổng `8891` / `5273`, dùng dữ liệu tạm trong `e2e/.tmp/`. Claude được thay bằng script giả; bài kiểm thử không xác nhận khả năng tương thích với CLI thật. Sau khi chạy, xem báo cáo bằng `npm --prefix e2e run report`.

## Bố cục mã nguồn

| Đường dẫn | Vai trò |
|---|---|
| `server/src/index.ts`, `app.ts` | CLI, khởi tạo dịch vụ và đăng ký routes |
| `server/src/core/` | Hạ tầng dùng chung, khởi chạy CLI, trạng thái và i18n |
| `server/src/modules/<name>/` | Tính năng server; `index.ts` là điểm truy cập giữa các module |
| `server/test/` | Kiểm thử theo cấu trúc server; tiện ích ở `helpers/` |
| `client/src/app/` | Ghép ứng dụng và bố cục |
| `client/src/features/<name>/` | Thành phần, hooks, API, kiểu dữ liệu và CSS theo tính năng |
| `client/src/shared/` | API và UI dùng chung, router |
| `client/src/styles/`, `client/src/i18n/` | CSS nền và tài nguyên ngôn ngữ |
| `workflows/<id>/` | Workflow tích hợp, prompt và mẫu tài liệu |
| `subagents/claude/` | Mẫu subagent để cài vào repo người dùng |
| `e2e/` | Kiểm thử trình duyệt và môi trường giả lập |

Quy tắc import được kiểm tra trong [`architecture.test.ts`](../server/test/architecture.test.ts):

- `core/` không phụ thuộc module ở runtime; `shared/` không phụ thuộc `features/` hoặc `app/`; feature không phụ thuộc `app/`.
- Truy cập module hoặc feature khác qua `index.ts` của nó.
- CSS chỉ được import trong feature sở hữu, hoặc từ `app/`, `shared/`.
- Không có vòng phụ thuộc giữa client features, kể cả import kiểu; server modules không có vòng phụ thuộc runtime.

## Ngôn ngữ giao diện

Hiện ứng dụng chỉ có tiếng Việt. Chuỗi client nằm trong `client/src/i18n/locales/vi/`, chia theo namespace; chuỗi server gửi ra giao diện nằm trong `server/src/core/locales/vi.ts`.

Thêm ngôn ngữ bằng bộ tài nguyên tương ứng cho mỗi namespace. Kiểu trong `i18next.d.ts` kiểm tra khóa dịch; `i18n:lint` và [`i18n.test.ts`](../server/test/i18n.test.ts) kiểm tra chuỗi viết trực tiếp trong code. Văn bản prompt, nhật ký và tên cột cần phân tích có ngoại lệ riêng trong bài kiểm thử.

Xem [Kiến trúc](SPEC.md) để hiểu luồng phiên CLI và workflow. Khi đổi hành vi, cập nhật tài liệu phụ trách nội dung đó rồi dẫn link từ nơi khác, tránh sao chép lại toàn bộ.
