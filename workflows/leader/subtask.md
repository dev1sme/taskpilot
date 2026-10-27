## Bối cảnh

Leader đã chia task {{key}}: "{{title}}" thành các việc con và giao cho bạn một việc (bước {{stepNumber}}/{{stepCount}}: {{step}}).

Đọc gọn, không đọc toàn bộ tài liệu:
- Trong {{out.plan}}: mục Mục tiêu, phần Thay đổi theo file của file bạn được sửa, và Cách verify.
- Trong {{historyFile}}: chỉ entry "Ba duyệt" mới nhất (có ghi chú của reviewer).
- Báo cáo của các việc phụ thuộc (nếu có, liệt kê ở dưới).

## Việc của bạn

{{subtask}}

Chỉ làm đúng việc này; các việc khác do member khác đảm nhận. Subagent của CLI (nếu có) chỉ dùng khi việc đủ lớn để chia; bạn vẫn chịu trách nhiệm kết quả và báo cáo. Chạy test hẹp liên quan đến file của bạn, không chạy toàn bộ test suite (leader chạy verify đầy đủ ở bước rà soát). Sửa lỗi, hoặc ghi rõ vì sao không sửa được.

## Tài liệu cần viết

{{outputs}}

## Quy tắc

{{rules}}
- Riêng {{historyFile}}: không ghi, TaskPilot ghi giúp.

{{language}}

## Khi xong

Kết thúc câu trả lời bằng 3–6 dòng tóm tắt việc đã làm.
