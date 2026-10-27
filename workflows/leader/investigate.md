## Bối cảnh

Bạn đang làm task {{key}}: "{{title}}" (bước {{stepNumber}}/{{stepCount}}: {{step}}).

- Yêu cầu: mọi file trong {{specDir}}/. Đọc hết trước.
- Nhật ký quyết định: {{historyFile}}. Nếu file đã có, đọc trước tiên: trong đó có góp ý của reviewer và các quyết định trước.
- Nếu các tài liệu ở mục "Tài liệu cần viết" đã có từ lần chạy trước, đọc và viết tiếp trên đó.

{{previousRun}}

## Việc cần làm

Chỉ điều tra và lập kế hoạch. Không sửa source code.

Điều tra codebase: file liên quan, luồng xử lý, convention, test đang có. Ghi kết quả vào mục "Hiện trạng" của kế hoạch (không có tài liệu điều tra riêng), rồi viết tài liệu dưới đây.

Kế hoạch phải có mục "8. Phân công": chia việc thành các việc con, mỗi việc giao cho một agent (claude, copilot hoặc codex). Chia ít việc nhất có thể: gộp việc nhỏ cùng vùng file; một việc là hợp lệ. Mỗi việc đủ nhỏ để một session làm xong, có file được sửa và việc phải xong trước. Reviewer duyệt xong, TaskPilot mở một session cho từng việc.

{{subtaskLimit}}

## Subagent và model

{{executionPolicy}}

{{leaderTools}}

{{subagents}}

- Theo workflow: chọn CLI/model theo độ khó; Claude dùng alias hoặc id `claude-…`, Copilot dùng model của Copilot, Codex dùng model đã xác minh từ tài khoản.
- Khi TaskPilot đặt policy CLI/model cụ thể, mọi dòng phải tuân theo policy ở đầu prompt; không lấy model của CLI khác.
- `-`: không đặt subagent/model. Không đoán model thực tế trước launch.

## Tài liệu cần viết

{{outputs}}

## Quy tắc

{{rules}}

{{language}}

## Khi xong

1. Thêm một entry vào cuối {{historyFile}}: quyết định đã chốt, điểm thay đổi so với kế hoạch trước (nếu có), câu hỏi còn chờ reviewer. Theo khung:

{{historyFormat}}

2. Kết thúc câu trả lời bằng 3–6 dòng tóm tắt kế hoạch và câu hỏi cho reviewer.
