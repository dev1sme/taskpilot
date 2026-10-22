# {{key}} — Kế hoạch

## 1. Mục tiêu
<!-- Kết quả cần đạt, đo được. Ghi cả phần nằm ngoài phạm vi. -->

## 2. Thay đổi theo file
<!-- Mỗi file một gạch đầu dòng: `đường/dẫn` — thay đổi gì, vì sao. -->

## 3. Các bước
<!-- Đánh số theo thứ tự làm; mỗi bước đủ nhỏ để kiểm được. -->

## 4. Rủi ro
<!-- Bảng: | Rủi ro | Cách xử lý |. -->

## 5. Cách verify
<!-- Lệnh build/test chính xác trong code block, và kiểm tay nếu cần. -->

## 6. Câu hỏi mở
<!-- Mỗi câu một dòng: `1. <câu hỏi> — Đề xuất: <đề xuất của bạn>`. Ghi "Không có" nếu không còn câu nào. -->

## 7. Phân công
<!-- Một bảng đúng các cột dưới đây; TaskPilot đọc bảng này để giao việc sau khi reviewer duyệt. Mỗi dòng là một việc con cho một agent (claude hoặc copilot). `File`: file hoặc thư mục việc đó được sửa, cách nhau bằng dấu phẩy; hai việc có thể chạy song song chỉ khi File của chúng không trùng nhau. `Phụ thuộc`: số của các việc phải xong trước, vd `1, 2`; `-` nếu không có. `Subagent`, `Model`: theo mục "Subagent và model" của prompt; `-` nếu không đặt. -->

| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |
|---|------|-------|----------|-------|------|--------|-----------|
| 1 | <việc 1> | claude | <subagent hoặc -> | <model hoặc -> | <đường/dẫn> | <kết quả cần có> | - |
