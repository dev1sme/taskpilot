## Quy tắc sử dụng CodeGraph

1. Dùng CodeGraph để định vị file, symbol và luồng gọi; không coi kết quả của nó là bằng chứng cuối cùng về hành vi chương trình.
2. Ưu tiên truy vấn có tên symbol và path cụ thể, ví dụ: `apps/server/src/index.ts buildApp`. Nếu câu hỏi tự nhiên trả kết quả lạc đề, chuyển sang truy vấn cụ thể; không kết luận rằng code cần tìm không tồn tại.
3. `projectPath` chọn index gần nhất ở thư mục hiện tại hoặc thư mục cha; trỏ vào `apps/server/` không có nghĩa là chỉ tìm trong `apps/server/`. `maxFiles` giới hạn số file được hiển thị, không lọc phạm vi index.
4. Với repo có cả client và server, kiểm tra path của từng kết quả trước khi sử dụng. Tên chung như `App`, `usage`, `command` có thể khớp sai khu vực.
5. Có thể dùng phần source CodeGraph trả về để đọc code. Nếu excerpt có khoảng lược bỏ hoặc output bị cắt, mở đúng đoạn còn thiếu thay vì suy đoán.
6. Xem “blast radius”, caller count và call path là gợi ý. Trước khi sửa code dựa trên chúng, xác minh các references/call sites bằng source, LSP hoặc tìm kiếm có giới hạn; sau khi sửa, chạy test phù hợp.
7. Chỉ chẩn đoán hoặc tạo lại index khi có dấu hiệu cụ thể về index lỗi/stale. Kết quả xếp hạng kém, tự nó, chưa chứng minh index bị hỏng hay cần tách web/server.