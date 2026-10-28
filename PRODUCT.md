# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Người dùng điều phối và giám sát công việc của các coding agent trong repository mã nguồn. Họ cần theo dõi tiến độ, biết agent nào đang làm việc, xử lý yêu cầu duyệt hoặc trả lời, và kiểm tra tài liệu, kết quả, terminal trong quá trình làm việc lâu dài.

Chưa xác định sản phẩm ưu tiên người dùng cá nhân hay nhóm; không mặc định có vai trò, phân quyền hoặc cộng tác nhiều người.

## Product Purpose

TaskPilot là ứng dụng điều phối công việc cho Claude Code, Codex và Copilot.

Người dùng cần biết ngay:

- Task nào đang chạy và đang ở bước nào.
- Provider/agent và model nào đang thực hiện công việc.
- Việc gì cần người dùng duyệt hoặc trả lời.
- Cách mở tài liệu, kết quả và terminal của công việc đang theo dõi.

Thành công là người dùng hiểu trạng thái công việc và biết thao tác tiếp theo mà không phải tự ghép thông tin từ nhiều khu vực.

## Positioning

Sản phẩm tập trung vào việc điều phối và giám sát công việc qua nhiều coding agent. Theo triển khai hiện tại, TaskPilot kết nối CLI đã cài, sử dụng yêu cầu và tài liệu trong repo, theo dõi các bước workflow và cung cấp điểm duyệt, phản hồi, bàn giao agent trong trình duyệt.

## Operating Context

- Người dùng làm việc với repository mã nguồn, task, workflow, phiên agent và tài liệu đầu ra.
- Giao diện và tài liệu hiện tại sử dụng tiếng Việt; giữ thuật ngữ kỹ thuật cần thiết như task, agent, provider, model, workflow và terminal.
- Task hiện được đọc từ `.claude/tasks/<key>/spec/`; tài liệu và lịch sử quyết định được lưu cùng task trong repo.
- Màn hình chi tiết task hiện tập hợp tiến độ, trạng thái thực thi, yêu cầu duyệt/trả lời, tài liệu, hoạt động, lịch sử và phiên terminal/hội thoại.
- Terminal và hội thoại khác nhau theo backend; giữ đúng cách tương tác mà từng agent hiện hỗ trợ.

## Capabilities and Constraints

- Giữ nguyên nghiệp vụ và tất cả thao tác hiện có khi cải thiện giao diện.
- Giữ các luồng chọn workflow/agent/model, bắt đầu, duyệt, góp ý, trả lời, hủy, chạy lại, tiếp tục, bàn giao và đánh dấu hoàn thành/mở lại theo khả năng hiện có.
- Giữ khả năng xem tài liệu, kết quả, prompt đã gửi, lịch sử, hoạt động và truy cập phiên terminal/hội thoại.
- Không thay đổi ý nghĩa trạng thái, cơ chế duyệt hoặc quyền thực thi trong một thay đổi giao diện.
- Hiển thị provider/agent và model theo dữ liệu có thật; không biến model được yêu cầu thành khẳng định về model thực tế, không tự điền số liệu thiếu.
- Client đang được dựng lại toàn bộ (người dùng xác nhận 2026-10-28): toàn bộ màn hình thuộc phạm vi, theo DESIGN.md và các yêu cầu từ critique impeccable ghi trong đó. Cấu hình CLI có hai chế độ: UI chỉ xem và Raw sửa trực tiếp file.
- Giao diện của client cũ không phải hướng thiết kế đã được chấp thuận.

## Brand Commitments

- Giữ tên sản phẩm TaskPilot và tên các coding agent chính xác.
- Định hướng người dùng xác nhận: công cụ làm việc chuyên nghiệp, gọn, phân cấp thông tin rõ, dễ đọc khi sử dụng lâu.
- Hướng nhận diện đã xác nhận (2026-10-28, theo ui-ux-pro-max cho developer tool): điềm tĩnh, chuyên nghiệp, ưu tiên giao diện tối, hỗ trợ cả sáng. Nền slate, xanh lá cho tương tác, font IBM Plex Sans và JetBrains Mono, logo SVG gợi các luồng công việc hội tụ; chi tiết token và quy tắc nằm trong DESIGN.md.

## Evidence on Hand

- Brief sản phẩm và giới hạn phạm vi do người dùng xác nhận trong phiên khởi tạo Impeccable.
- `README.md`: mục đích sản phẩm, CLI được hỗ trợ và cách chạy.
- `docs/GUIDE.md`: các luồng sử dụng, duyệt, phản hồi, bàn giao và phục hồi.
- `docs/SPEC.md`: cơ chế workflow, trạng thái và sự khác nhau giữa các backend.
- `docs/DEVELOP.md`: môi trường phát triển và cách kiểm tra.
- `apps/web/src/features/task/TaskScreen.tsx`: các thao tác và thành phần hiện có của màn hình chi tiết task; đối chiếu source liên quan trước khi sửa.
- `apps/web/src/i18n/locales/vi/`: nội dung giao diện tiếng Việt hiện có.
- `apps/server/test/` và `e2e/`: kiểm thử hiện có; sự tồn tại của test không khẳng định đã chạy hoặc đã đạt trong phiên này.

## Product Principles

1. Cho người dùng biết trạng thái hiện tại, bước đang chạy và agent/model phụ trách ngay khi xem công việc.
2. Làm rõ việc cần người dùng xử lý cùng hành động tương ứng.
3. Giúp mở tài liệu, kết quả và phiên làm việc đúng ngữ cảnh.
4. Ưu tiên sự gọn gàng, phân cấp thông tin và khả năng đọc trong thời gian dài.
5. Cải thiện cách trình bày nhưng giữ nguyên ý nghĩa dữ liệu, nghiệp vụ và khả năng thao tác.

## Accessibility & Inclusion

Khả năng đọc khi sử dụng lâu là yêu cầu đã được xác nhận. Chưa có yêu cầu riêng về công nghệ hỗ trợ hoặc chuẩn tuân thủ được xác nhận; không coi đây là bằng chứng giao diện hiện tại đã đáp ứng một chuẩn tiếp cận cụ thể.
