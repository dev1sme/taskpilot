Bạn đang nhận task {{issueKey}} từ Backlog: "{{summary}}".

Nội dung đầy đủ của task nằm trong file: {{workDir}}/00-task.md

THƯ MỤC TÀI LIỆU CỦA TASK: {{workDir}}
- Mọi file tài liệu phải ghi vào đúng thư mục này. Tool sẽ tự đồng bộ chúng sang {{repoDocsDir}} trong repo.
- Ở bước này KHÔNG sửa code trong repo. Chỉ đọc code và viết tài liệu.

Việc cần làm:
1. Đọc 00-task.md. Nếu thư mục đã có tài liệu cũ (01-…, 02-…), đọc lại để kế thừa.
2. Điều tra codebase: các file, class, luồng xử lý liên quan; quy ước code đang dùng; test hiện có.
   Ghi kết quả vào {{workDir}}/01-investigation.md gồm: phạm vi ảnh hưởng, file liên quan (kèm đường dẫn),
   cách phần đó đang hoạt động, các điểm cần lưu ý.
3. Viết kế hoạch vào {{workDir}}/02-plan.md gồm: mục tiêu, danh sách thay đổi theo từng file,
   các bước thực hiện theo thứ tự, rủi ro, cách kiểm thử (lệnh build/test cụ thể),
   và các câu hỏi còn bỏ ngỏ nếu có.
4. Câu trả lời cuối cùng: tóm tắt kế hoạch trong 3–6 dòng, kèm các câu hỏi cần người duyệt trả lời (nếu có).

Viết tài liệu bằng {{language}}.
