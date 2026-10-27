# {{key}} — Kế hoạch

## 1. Mục tiêu & phạm vi
<!-- Kết quả cần đạt, đo được. Ghi cả phần nằm ngoài phạm vi. -->

## 2. Hiện trạng
<!-- Phần liên quan đang chạy thế nào hôm nay: luồng chính, convention, test đang có. Dẫn `file:dòng`. -->

## 3. Thay đổi theo file
<!-- Mỗi file một gạch đầu dòng: `đường/dẫn` — thay đổi gì, vì sao. Gồm cả test và docs liên quan. -->

## 4. Các bước
<!-- Đánh số theo thứ tự làm; mỗi bước đủ nhỏ để kiểm được. -->

## 5. Rủi ro
<!-- Bảng: | Rủi ro | Cách xử lý |. Gồm những gì dễ hỏng hoặc chưa rõ khi sửa. -->

## 6. Cách verify
<!-- Lệnh build/test chính xác trong code block, và kiểm tay nếu cần. -->

## 7. Câu hỏi mở
<!-- Mỗi câu một dòng: `1. <câu hỏi> — Đề xuất: <đề xuất của bạn>`. Ghi "Không có" nếu không còn câu nào. -->

## 8. Phân công
<!-- Một bảng đúng các cột dưới đây; TaskPilot đọc bảng này để giao việc sau khi reviewer duyệt. Mỗi dòng là một việc con cho một agent (claude, copilot hoặc codex). `File`: file hoặc thư mục việc đó được sửa, cách nhau bằng dấu phẩy; hai việc có thể chạy song song chỉ khi File của chúng không trùng nhau. `Phụ thuộc`: số của các việc phải xong trước, vd `1, 2`; `-` nếu không có. `Agent`, `Subagent`, `Model`: theo chính sách thực thi TaskPilot và mục "Subagent và model" của prompt; `-` nếu không đặt. -->

| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |
|---|------|-------|----------|-------|------|--------|-----------|
| 1 | <việc 1> | <CLI theo policy> | <subagent hoặc -> | <model hoặc -> | <đường/dẫn> | <kết quả cần có> | - |
