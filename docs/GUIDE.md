# Sử dụng TaskPilot

[Cài và chạy TaskPilot](../README.md#cài-và-chạy) trước khi bắt đầu.

## Tạo task đầu tiên

Trong repo bạn muốn xử lý:

```bash
mkdir -p .claude/tasks/DEMO-1/spec
cat > .claude/tasks/DEMO-1/spec/requirements.md <<'EOF'
# Thêm trạng thái rỗng cho danh sách task

Khi danh sách không có task, hiển thị hướng dẫn tạo task đầu tiên.
Giữ cách hiển thị hiện tại khi có dữ liệu.
EOF
```

Mở repo đó trong TaskPilot. Task xuất hiện khi `spec/` có ít nhất một file `.md`; thư mục con cũng được đọc. Tiêu đề lấy từ heading `#` đầu tiên trong file spec đứng đầu theo tên, hoặc dùng mã task nếu không có heading.

```text
.claude/tasks/DEMO-1/
  spec/                  # Yêu cầu bạn viết
  00-history.md          # Nhật ký quyết định, góp ý và duyệt
  01-investigation.md    # Tài liệu agent tạo theo workflow mặc định
  02-plan.md
  03-progress.md
  04-summary.md
  task.yml               # Trạng thái hoàn thành do TaskPilot quản lý
  archive/<stamp>/       # Tài liệu của lần chạy trước khi chạy lại từ đầu
```

## Chạy và duyệt

1. Mở task, chọn **Cách chạy** rồi **Bắt đầu quy trình**. Chế độ `default` dùng Claude lập kế hoạch và Copilot triển khai; [cấu hình chỉ dùng Claude](CONFIGURATION.md#agent-và-model) nếu cần.
2. Theo dõi các bước, hoạt động và tài liệu. Nếu CLI hỏi quyền hoặc xác nhận tin cậy thư mục, trả lời trong terminal; Codex có nút **Chấp nhận** / **Từ chối** trên thẻ và trong hội thoại.
3. Khi chờ duyệt, đọc tài liệu rồi chọn **Duyệt** để tiếp tục hoặc **Gửi góp ý** để agent sửa. Câu hỏi có đánh số sẽ có ô trả lời riêng; **Duyệt kèm trả lời** lưu câu trả lời để bước tiếp theo đọc.
4. Nếu agent dừng để hỏi mà chưa viết đủ tài liệu, trả lời trên thẻ hoặc trong terminal. **Prompt đã gửi** cho phép xem lại nội dung TaskPilot đã chuyển cho agent.
5. Duyệt bước cuối để hoàn thành task. Bắt đầu, góp ý, trả lời, duyệt, hủy và chạy lại được ghi vào `00-history.md`.

## Gián đoạn và chạy lại

| Tình huống | Cách xử lý |
|---|---|
| Agent đang chờ câu trả lời hoặc quyền | Trả lời trên thẻ hoặc trong terminal |
| Phiên bị thoát, hoặc TaskPilot vừa khởi động lại | Chọn **Gửi lại bước** để tiếp tục phiên và gửi lại prompt |
| Muốn thực hiện lại toàn bộ quy trình | Chọn **Chạy lại từ đầu** và xác nhận |
| Copilot báo không nhận được hook | Kiểm tra terminal; chỉ dùng **Đánh dấu xong** khi đã kiểm tra kết quả và file đầu ra đã được ghi |

Chạy lại từ đầu sẽ dừng phiên hiện tại, tạo phiên mới từ bước đầu và sao lưu các tài liệu `.md` ở cấp task vào `archive/<stamp>/`, trừ nhật ký. `spec/` và `task.yml` không bị đưa vào archive. Prompt mới hướng dẫn agent đọc tài liệu cũ để giữ bối cảnh; phiên cũ vẫn có thể tiếp tục từ tab terminal.

## Hoàn thành và mở lại task

Có đủ tài liệu chưa đồng nghĩa task đã hoàn thành. Duyệt bước cuối sẽ ghi `status: done` vào `task.yml`; bắt đầu hoặc chạy lại ghi `status: open`. Với task cũ chưa có file này, TaskPilot dùng kết quả lần chạy đã hoàn thành.

Bạn cũng có thể dùng **Đánh dấu hoàn thành** / **Mở lại** trên task hoặc danh sách. Khi còn một lần chạy hoạt động, cần hủy hoặc duyệt xong trước khi đổi thủ công. Nhãn **Chờ xác nhận** nghĩa là đã có tài liệu nhưng chưa được đánh dấu hoàn thành.

## Chế độ leader

Chọn `leader` ở **Cách chạy**, hoặc đặt làm mặc định của repo trên trang **Workflow**. Claude lập kế hoạch có bảng **Phân công**; bạn chỉ duyệt được khi bảng hợp lệ.

Sau khi duyệt, mỗi dòng trở thành một việc con với phiên riêng. Trả lời ở ô của từng việc; dùng **Gửi lại việc** nếu bị gián đoạn. Khi các việc hoàn tất, leader đọc báo cáo và tổng kết để bạn duyệt. Cách chia việc, chọn model và chạy song song nằm trong [cấu hình leader](CONFIGURATION.md#leader-và-việc-con).

### Subagent và model

Leader xem danh sách subagent dùng được của repo khi lập kế hoạch: dò code bằng subagent chỉ đọc với model rẻ, rồi điền cột **Subagent** và **Model** cho từng việc (việc dễ dùng `haiku`, thông thường `sonnet`, khó hoặc cần rà soát kỹ dùng `opus`; `-` là mặc định). Bạn kiểm tra hai cột này ở bảng xem trước khi duyệt; tên subagent sai hoặc subagent chỉ đọc làm việc con sẽ chặn duyệt.

Repo chưa có subagent thì màn hình task báo thiếu, kèm liên kết tới trang **Agents**. Ở đó bấm **Ghi subagent mẫu của TaskPilot**, xem diff rồi ghi; badge trên từng agent cho biết dùng được cho leader hay làm việc con ([chi tiết](CONFIGURATION.md#subagent-và-model)).

Mỗi việc con hiển thị subagent, model, và khi xong có thêm model thật, thời gian và chi phí (Claude). Bước rà soát của leader dùng số liệu này để viết mục **Đánh giá subagent / model** trong tổng kết: việc nào nên đổi model, subagent nào hiệu quả. Số liệu thiếu được ghi là không có, không ước đoán; hãy đọc cùng chất lượng kết quả trước khi đổi lựa chọn cho lần sau.

## Terminal và mức sử dụng

Một task có thể có nhiều tab phiên; **+ Session mới** mở phiên tự do ngoài workflow. Tải lại trang giữ các phiên; khởi động lại server sẽ dừng chúng và cho phép tiếp tục.

**Terminal** ở thanh trạng thái mở phiên chung cho repo, không thuộc task nào. Menu **+** của task và repo cho chọn Claude, Copilot hoặc Codex.

Phiên Codex hiển thị hội thoại thay vì terminal. Nhập nhiều dòng, bấm **Gửi** hoặc Ctrl/⌘+Enter; **Ngắt lượt** dừng lượt đang chạy, còn **Dừng** đóng tiến trình. **Tiếp tục** resume đúng thread và model đã lưu. Quyền phải được duyệt bằng **Chấp nhận** / **Từ chối**; yêu cầu hết hạn không thể trả lời lại. Đóng trang không tự duyệt quyền; dừng phiên sẽ hủy quyền còn chờ. Sau khi TaskPilot khởi động lại, bộ đệm hội thoại bắt đầu từ lượt mới; nội dung cũ còn trong lịch sử hoạt động. Nút mức sử dụng hiển thị hạn mức tài khoản Claude/Copilot và thời điểm cập nhật; đây không phải mức sử dụng riêng của task. `Copilot ∞` nghĩa là tài khoản không có giới hạn riêng được báo về.

Các trang cấu hình, **Thư viện**, **Workflow** và **Lịch sử thay đổi** dùng để chỉnh và khôi phục cấu hình; xem [Cấu hình](CONFIGURATION.md).
