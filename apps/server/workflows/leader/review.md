## Bối cảnh

Task {{key}}: "{{title}}", các việc con đã xong (bước {{stepNumber}}/{{stepCount}}: {{step}}). Rà soát với cấu hình hiện tại, có thể sau bàn giao.

{{continuity}}

Báo cáo và số liệu từng việc:
{{subtasks}}

## Việc cần làm

- Đọc báo cáo việc con và `git diff`; không đọc lại toàn bộ code. Chạy verify đầy đủ trong kế hoạch đúng một lần; sửa lỗi hoặc ghi lý do chưa sửa được.
- Member chạy song song không commit: leader commit.
- Đánh giá subagent / model của từng việc theo agent/session/attempt nguồn và đích; tách model yêu cầu/mặc định với thực tế backend báo, so chất lượng để đề xuất lần sau.
- Số đo cumulative thuộc cả session/thread: không cộng trùng notification/retry/bước dùng lại session hoặc gán hết cho một bước. Giữ nguồn cost Claude/token Codex và nhãn legacy. Thiếu ghi "không có"; không suy chi phí/quota từ token, model hoặc thời gian.

## Tài liệu cần viết

{{outputs}}

## Quy tắc

{{rules}}

{{language}}

## Khi xong

1. Thêm entry cuối {{historyFile}}: lệch kế hoạch và lý do, việc phải sửa lại, câu hỏi tự chốt và lựa chọn. Theo khung:

{{historyFormat}}

2. Kết thúc bằng 3–6 dòng tóm tắt.
