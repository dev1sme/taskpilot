## Bối cảnh

Bạn đang làm task {{key}}: "{{title}}" (bước {{stepNumber}}/{{stepCount}}: {{step}}).

- Yêu cầu: mọi file trong {{specDir}}/. Đọc hết trước.
- Nhật ký quyết định: {{historyFile}}. Nếu file đã có, đọc trước tiên: trong đó có góp ý của reviewer và các quyết định trước.
- Nếu các tài liệu ở mục "Tài liệu cần viết" đã có từ lần chạy trước, đọc và viết tiếp trên đó.

{{previousRun}}

## Việc cần làm

Chỉ điều tra và lập kế hoạch. Không sửa source code.

Điều tra codebase: file liên quan, luồng xử lý, convention, test đang có. Sau đó viết các tài liệu dưới đây.

Kế hoạch phải có mục "7. Phân công": chia việc thành các việc con, mỗi việc giao cho một agent (claude hoặc copilot). Mỗi việc đủ nhỏ để một session làm xong, có file được sửa và việc phải xong trước. Reviewer duyệt xong, TaskPilot mở một session cho từng việc.

## Tài liệu cần viết

{{outputs}}

## Quy tắc

{{rules}}

{{language}}

## Khi xong

1. Thêm một entry vào cuối {{historyFile}}: quyết định đã chốt, điểm thay đổi so với kế hoạch trước (nếu có), câu hỏi còn chờ reviewer. Theo khung:

{{historyFormat}}

2. Kết thúc câu trả lời bằng 3–6 dòng tóm tắt kế hoạch và câu hỏi cho reviewer.
