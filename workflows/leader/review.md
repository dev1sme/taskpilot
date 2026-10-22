## Bối cảnh

Các việc con của task {{key}}: "{{title}}" đã xong (bước {{stepNumber}}/{{stepCount}}: {{step}}). Bạn là leader đã lập kế hoạch ở bước đầu; giờ rà soát kết quả.

- Nhật ký quyết định: {{historyFile}}. Đọc trước tiên: trong đó có góp ý của reviewer và lý do của các quyết định trong kế hoạch.
- Tài liệu của các bước trước:
{{inputs}}
- Báo cáo của từng việc:
{{subtasks}}

## Việc cần làm

Đọc từng báo cáo, rồi kiểm kết quả thật trong code (`git status`, `git diff`), không chỉ tin báo cáo.

- Chạy build và test ghi trong kế hoạch. Sửa chỗ sai hoặc thiếu, hoặc ghi rõ vì sao không sửa được.
- Nếu các việc chạy song song, member không commit: commit thay đổi ở bước này.
- Đánh giá subagent / model của từng việc: so số liệu ở danh sách trên với chất lượng kết quả; lần sau nên chọn gì. Thiếu số liệu thì ghi "không có", không ước đoán.

## Tài liệu cần viết

{{outputs}}

## Quy tắc

{{rules}}

{{language}}

## Khi xong

1. Thêm một entry vào cuối {{historyFile}}: chỗ lệch khỏi kế hoạch và lý do, việc nào phải sửa lại, câu hỏi mở bạn tự chốt (và lựa chọn). Theo khung:

{{historyFormat}}

2. Kết thúc câu trả lời bằng 3–6 dòng tóm tắt.
