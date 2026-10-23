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

1. Mở task, chọn **Cách chạy**, **Agent**, **Model**, xem trước cấu hình hiệu lực rồi **Bắt đầu quy trình**. **Theo cấu hình workflow** giữ cách phối hợp CLI của workflow; agent cụ thể áp dụng cho cả quy trình.
2. Theo dõi các bước, hoạt động và tài liệu. Nếu CLI hỏi quyền hoặc xác nhận tin cậy thư mục, trả lời trong terminal; Codex có nút **Chấp nhận** / **Từ chối** trên thẻ và trong hội thoại.
3. Khi chờ duyệt, đọc tài liệu rồi chọn **Duyệt** để tiếp tục hoặc **Gửi góp ý** để agent sửa. Câu hỏi có đánh số sẽ có ô trả lời riêng; **Duyệt kèm trả lời** lưu câu trả lời để bước tiếp theo đọc.
4. Nếu agent dừng để hỏi mà chưa viết đủ tài liệu, trả lời trên thẻ hoặc trong terminal. **Prompt đã gửi** cho phép xem lại nội dung TaskPilot đã chuyển cho agent.
5. Duyệt bước cuối để hoàn thành task. Bắt đầu, góp ý, trả lời, duyệt, hủy và chạy lại được ghi vào `00-history.md`.

## Chọn agent và model

**Cách chạy** chọn các bước (`default`, `leader` hoặc custom); **Agent** chọn CLI thực hiện. Ví dụ `leader` + **Codex** + **Mặc định của agent** chạy điều tra, mọi việc con và review bằng Codex, không cần override YAML. Với `default` + **Codex**, bước triển khai vốn dùng Copilot cũng dùng Codex.

**Theo cấu hình workflow** giữ agent/model từng bước và từng dòng Phân công. Chọn agent cụ thể là một lựa chọn đầy đủ: **Mặc định của agent** không truyền model, không lấy model YAML. Model thực tế chỉ được xác nhận khi backend báo. Codex có danh sách từ `model/list` của tài khoản; picker Claude/Copilot hiện chỉ có Mặc định vì chưa có inventory đáng tin cậy. Model đã ghi trong YAML/bảng vẫn dùng được theo chế độ workflow với mức kiểm chứng được hiển thị.

**Dùng agent/model làm mặc định repo** chỉ lưu lựa chọn cho run mới; **Dùng cách chạy làm mặc định repo** lưu workflow riêng. Run đang chạy và run cũ thiếu execution không bị đổi. Form **Chạy lại từ đầu** lấy lựa chọn của run trước để bạn xem/sửa, rồi tạo run mới. Đổi agent trong form sẽ bỏ model đang chọn để tránh mang model sang CLI khác. Xem [schema và thứ tự ưu tiên](CONFIGURATION.md#lựa-chọn-execution-và-mặc-định-repo).

## Tiếp tục bằng agent khác

Ở thẻ bước chính hoặc đúng việc con đang dở, chọn **Tiếp tục bằng…**, chọn agent/model đích, thêm lý do nếu cần và **Xem trước bàn giao**. Đọc phạm vi, tài liệu, đầu ra còn thiếu và phần chưa rõ. Nếu nguồn còn chạy/chờ quyền, đánh dấu xác nhận dừng nguồn và hủy quyền đang chờ trước **Xác nhận bàn giao**. Nguồn đã thoát không cần xác nhận dừng.

Bàn giao chỉ thay bước/việc đang chọn. TaskPilot chờ nguồn thoát, mở session và native thread mới, gửi bối cảnh từ dữ liệu sẵn có; không yêu cầu nguồn còn quota hay tóm tắt thêm. Spec, code, tài liệu, phụ thuộc, việc đã hoàn tất và các gate được giữ. Retry/góp ý ở lane đó dùng đích; bước tương lai và các lane khác tiếp tục theo policy đã lưu. Workflow có quyền/subagent không tương thích sẽ bị chặn, kèm field cần sửa; không tự tăng quyền hoặc bỏ hạn chế.

Không bàn giao tại gate, run done/cancelled, việc đã xong hoặc chưa từng bắt đầu. Phiên nguồn được giữ để xem lịch sử, bị khóa input/resume khi đang chuyển và sau khi được thay. Tab đích được chọn sau thành công, trừ khi phiên khác đang xin quyền cần được ưu tiên.

Nếu preflight lỗi, sửa CLI/đăng nhập/model/quyền rồi xem trước lại. Nếu bàn giao thất bại trước commit, nguồn vẫn là lane hiện hành: dùng **Gửi lại bước**/**Gửi lại việc** để chủ động trở về nguồn, hoặc mở bàn giao mới sau khi tiến trình đích đã dọn xong. Nếu đã commit, retry dùng đích. Khi phản hồi xác nhận không rõ, dùng **Kiểm tra / gửi lại xác nhận** với cùng mã thao tác; kiểm lịch sử trước khi retry. Sau server crash, TaskPilot không tự gửi lại prompt; lane không xác minh được tiến trình đã dừng bị khóa đến khi xử lý xong. Xem [recovery](SPEC.md#8-execution-và-bàn-giao).

## Gián đoạn và chạy lại

| Tình huống | Cách xử lý |
|---|---|
| Agent đang chờ câu trả lời hoặc quyền | Trả lời trên thẻ hoặc trong terminal |
| Phiên bị thoát, hoặc TaskPilot vừa khởi động lại | Chọn **Gửi lại bước** để tiếp tục phiên và gửi lại prompt |
| Muốn đổi agent ở bước/việc đang dở | Dùng **Tiếp tục bằng…** trên đúng lane |
| Muốn thực hiện lại toàn bộ quy trình | Chọn **Chạy lại từ đầu** và xác nhận |
| Copilot báo không nhận được hook | Kiểm tra terminal; chỉ dùng **Đánh dấu xong** khi đã kiểm tra kết quả và file đầu ra đã được ghi |

Chạy lại từ đầu sẽ dừng phiên hiện tại, tạo phiên mới từ bước đầu và sao lưu các tài liệu `.md` ở cấp task vào `archive/<stamp>/`, trừ nhật ký. `spec/` và `task.yml` không bị đưa vào archive. Prompt mới hướng dẫn agent đọc tài liệu cũ để giữ bối cảnh. Bàn giao giữ nguyên bước và không tạo archive; phiên đã bị thay chỉ còn để xem lịch sử.

## Hoàn thành và mở lại task

Có đủ tài liệu chưa đồng nghĩa task đã hoàn thành. Duyệt bước cuối sẽ ghi `status: done` vào `task.yml`; bắt đầu hoặc chạy lại ghi `status: open`. Với task cũ chưa có file này, TaskPilot dùng kết quả lần chạy đã hoàn thành.

Bạn cũng có thể dùng **Đánh dấu hoàn thành** / **Mở lại** trên task hoặc danh sách. Khi còn một lần chạy hoạt động, cần hủy hoặc duyệt xong trước khi đổi thủ công. Nhãn **Chờ xác nhận** nghĩa là đã có tài liệu nhưng chưa được đánh dấu hoàn thành.

## Chế độ leader

Chọn `leader` ở **Cách chạy**, hoặc đặt làm mặc định của repo trên trang **Workflow**. Agent hiệu lực của leader lập kế hoạch có bảng **Phân công**; bạn chỉ duyệt được khi bảng hợp lệ. Nếu chọn một agent/model cho cả run, các dòng phải khớp policy đó; lỗi ghi rõ số việc và field, TaskPilot không tự sửa bảng hoặc đổi CLI.

Sau khi duyệt, mỗi dòng trở thành một việc con với phiên riêng. Trả lời ở ô của từng việc; dùng **Gửi lại việc** nếu bị gián đoạn. Khi các việc hoàn tất, leader đọc báo cáo và tổng kết để bạn duyệt. Cách chia việc, chọn model và chạy song song nằm trong [cấu hình leader](CONFIGURATION.md#leader-và-việc-con).

### Subagent và model

Leader Claude có thể dò code bằng subagent chỉ đọc của repo, rồi điền **Subagent** và **Model** cho từng việc. Leader Codex/Copilot dùng khả năng CLI tương ứng, không bị yêu cầu gọi Task tool của Claude. Kiểm tra các cột ở bảng xem trước khi duyệt; tên subagent Claude sai hoặc subagent chỉ đọc làm việc con sẽ chặn duyệt. Dòng Codex có thể điền tên file trong `.codex/agents/` (không kèm `.toml`) hoặc `-`; với policy một agent và model mặc định, Model là `-`, với model cụ thể thì mọi dòng dùng đúng model đó.

Repo chưa có subagent thì màn hình task báo thiếu, kèm liên kết tới trang **Agents**. Ở đó bấm **Ghi subagent mẫu của TaskPilot**, xem diff rồi ghi; badge trên từng agent cho biết dùng được cho leader hay làm việc con ([chi tiết](CONFIGURATION.md#subagent-và-model)).

Mỗi việc con hiển thị subagent, model, và khi xong có thêm model thật, thời gian và chi phí (Claude). Bước rà soát của leader dùng số liệu này để viết mục **Đánh giá subagent / model** trong tổng kết: việc nào nên đổi model, subagent nào hiệu quả. Số liệu thiếu được ghi là không có, không ước đoán; hãy đọc cùng chất lượng kết quả trước khi đổi lựa chọn cho lần sau.

Sau bàn giao, **Các lần thực thi** và **Số liệu từ … session** giữ riêng nguồn Claude statusline/Codex thread/dữ liệu cũ. Token cumulative của cùng session/thread chỉ tính một lần, không phải chi phí riêng từng bước; số đo thiếu không thành 0 và không dùng token để suy chi phí.

## Terminal và mức sử dụng

Một task có thể có nhiều tab phiên; **+ Session mới** mở phiên tự do ngoài workflow. Tải lại trang giữ các phiên; khởi động lại server sẽ dừng chúng và cho phép tiếp tục.

**Terminal** ở thanh trạng thái mở phiên chung cho repo, không thuộc task nào. Menu **+** của task và repo cho chọn Claude, Copilot hoặc Codex.

Phiên Codex hiển thị hội thoại thay vì terminal. Nhập nhiều dòng, bấm **Gửi** hoặc Ctrl/⌘+Enter; **Ngắt lượt** dừng lượt đang chạy, còn **Dừng** đóng tiến trình. **Tiếp tục** resume đúng thread và model đã lưu. Quyền phải được duyệt bằng **Chấp nhận** / **Từ chối**; yêu cầu hết hạn không thể trả lời lại. Đóng trang không tự duyệt quyền; dừng phiên sẽ hủy quyền còn chờ. Sau khi TaskPilot khởi động lại, bộ đệm hội thoại bắt đầu từ lượt mới; nội dung cũ còn trong lịch sử hoạt động. Trong ô nhập có thể dùng `/compact`, `/review`, `/model`, `/skills` và `$skill`; lệnh khác chỉ có trong TUI Codex sẽ được báo rõ và không gửi cho model. Nút mức sử dụng hiển thị hạn mức tài khoản Claude/Copilot và Codex (5h/7d, giờ reset, thời điểm cập nhật; Codex chỉ có khi đang có phiên Codex); đây không phải mức sử dụng riêng của task. `Copilot ∞` nghĩa là tài khoản không có giới hạn riêng được báo về.

Các trang cấu hình, **Thư viện**, **Workflow** và **Lịch sử thay đổi** dùng để chỉnh và khôi phục cấu hình; xem [Cấu hình](CONFIGURATION.md).

Chỉ khi backend có bằng chứng quota đúng lượt, thẻ mới khẳng định hết hạn mức và gợi ý chuyển. **Tiếp tục bằng Codex**/**Chọn agent khác** vẫn mở preview/xác nhận; **Để sau** không chuyển agent. Claude/Copilot chưa nhận diện quota theo lượt; số hạn mức tài khoản kèm thời điểm chỉ là tham khảo. Timeout, không có hook, HTTP 429 và lỗi chưa rõ không chứng minh hết quota. Bạn vẫn có thể bàn giao thủ công khi lane đủ điều kiện; TaskPilot không tự fallback hoặc bật credits.
