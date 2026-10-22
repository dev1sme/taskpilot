# Kiến trúc TaskPilot

Tài liệu mô tả cơ chế hiện tại. Cách sử dụng nằm trong [GUIDE](GUIDE.md), định dạng workflow trong [CONFIGURATION](CONFIGURATION.md), xác thực trong [DEPLOY](DEPLOY.md), quy tắc mã nguồn trong [DEVELOP](DEVELOP.md). Lịch sử triển khai được giữ trong Git.

## 1. Các thành phần

```text
Trình duyệt: React + Vite + xterm.js
  ├─ HTTP: API
  ├─ SSE: cập nhật trạng thái và hoạt động
  └─ WebSocket: nhập/xuất terminal
             │
Server: Node.js + TypeScript + Fastify
  ├─ RepoScanner: quét và theo dõi task
  ├─ SessionManager: mở/tiếp tục phiên CLI qua node-pty
  ├─ WorkflowEngine: gửi prompt, kiểm tra đầu ra, chờ duyệt
  ├─ ActivityStore: lưu và phát hoạt động từ hooks
  └─ StateStore: lưu phiên, lần chạy và repo gần nhất
             │
       Claude Code / Copilot CLI
             └─ Hooks gọi về /hook/:event bằng curl
```

[`app.ts`](../server/src/app.ts) khởi tạo dịch vụ và nối sự kiện: hook tới activity và engine, phiên thoát tới engine, thông tin hạn mức tới usage, thay đổi dữ liệu tới SSE.

## 2. Vòng đời một bước

Engine lấy bản chụp workflow lúc bắt đầu. Nó tạo phiên, chờ sẵn sàng, gửi prompt bằng bracketed paste rồi chờ kết thúc lượt. Đầu ra `done-when` phải được ghi sau thời điểm gửi prompt; tài liệu còn từ lần chạy trước không tự làm bước hoàn thành.

| Trạng thái | Ý nghĩa |
|---|---|
| `starting` | Chờ phiên sẵn sàng |
| `running` | Agent đang thực hiện bước hoặc các việc con |
| `waiting` | Agent kết thúc lượt nhưng chưa có đầu ra yêu cầu |
| `gate` | Đã có đầu ra, chờ người duyệt hoặc góp ý |
| `interrupted` | Phiên bị thoát hoặc server khởi động lại |
| `done` / `cancelled` | Lần chạy hoàn thành hoặc bị hủy |

Khi có tín hiệu kết thúc lượt và đầu ra hợp lệ, `gate: approve` chờ người dùng; `gate: none` đi tiếp. Góp ý được ghép vào `on-reject`; câu trả lời được gửi vào phiên. Đổi agent hoặc model giữa hai bước sẽ tạo phiên mới, chuyển bối cảnh bằng tài liệu và nhật ký.

Mã chính: [`engine.ts`](../server/src/modules/workflow/engine.ts), [`definition.ts`](../server/src/modules/workflow/definition.ts), [`vars.ts`](../server/src/modules/workflow/vars.ts). HTTP routes nằm trong [`routes.ts`](../server/src/modules/workflow/routes.ts).

## 3. Giao việc con

Sau khi kế hoạch được duyệt, `dispatch` chuyển từng dòng trong bảng **Phân công** thành một phiên. Bộ điều phối chỉ khởi động việc đã đủ phụ thuộc, còn chỗ theo `parallel` và không chồng lấn đường dẫn khai báo với việc đang chạy.

Việc con hoàn thành khi đã ghi báo cáo trong lượt hiện tại và nhận tín hiệu kết thúc. Việc thiếu báo cáo chuyển sang chờ trả lời; việc mất phiên chuyển sang gián đoạn. Leader không điều khiển tiến độ trong lúc dispatch; khi mọi việc xong, phiên leader tiếp tục bước rà soát và đọc các báo cáo.

Bảng phân công, trạng thái và câu hỏi việc con được trả về cùng dữ liệu lần chạy. Quy tắc phân tích nằm trong [`assignments.ts`](../server/src/modules/workflow/assignments.ts). Các phiên cùng dùng repo đang mở; kiểm tra phạm vi file không thay thế worktree hay sandbox.

## 4. Tích hợp CLI

Mỗi CLI có một `AgentBackend` trong [`sessions/backends/`](../server/src/modules/sessions/backends), phụ trách khởi chạy, hooks, nhận biết sẵn sàng và chuẩn hóa sự kiện. Engine và activity sử dụng tên sự kiện chung như `SessionStart`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`.

- **Claude:** truyền hooks bằng `--settings`, ghép cùng cấu hình người dùng. `statusLine` do TaskPilot chèn gửi mức sử dụng về server rồi gọi tiếp status line của người dùng. Tiếp tục phiên bằng `--resume`.
- **Copilot:** cài hooks tại `$COPILOT_HOME/hooks/taskpilot.json`, mặc định dưới `~/.copilot`. Hooks chỉ chạy cho phiên có biến môi trường TaskPilot phù hợp. `--session-id` dùng cho cả tạo và tiếp tục phiên.
- Môi trường con bỏ các biến `CLAUDE*` kế thừa để transcript được lưu bình thường, đồng thời loại bí mật đăng nhập UI. Kho môi trường MCP được thêm vào các phiên TaskPilot mở.
- Khi tiếp tục, TaskPilot truyền lại `--agent` và `--model` nếu có cấu hình, để giữ lựa chọn của phiên.

Hooks dùng token riêng theo tiến trình. Chi tiết quyền và nơi lưu cấu hình nằm trong [CONFIGURATION](CONFIGURATION.md).

## 5. Dữ liệu và mức sử dụng

Các đường dẫn dưới đây mặc định nằm trong `~/.taskpilot`; có thể đổi gốc bằng `TASKPILOT_HOME`:

| Dữ liệu | Nơi lưu |
|---|---|
| Phiên, lần chạy, workflow snapshot và repo gần nhất | `state.json` |
| Hoạt động theo phiên | `activity/<id>.jsonl` |
| Phiên đăng nhập dạng băm | `auth-sessions.json` |
| Biến bí mật cho MCP | `env.json` |
| Bản sao lưu cấu hình | `backups/` |
| Yêu cầu, đầu ra, nhật ký và trạng thái hoàn thành task | Trong repo; xem [cấu trúc task](GUIDE.md#tạo-task-đầu-tiên) |

Terminal chung của repo dùng khóa `@repo`, không thuộc danh sách task hay workflow. Phiên CLI là tiến trình con nên không sống qua lần khởi động lại server.

Mức sử dụng Claude đến từ `statusLine`. Copilot được đọc qua JSON-RPC `account.getQuota` của tiến trình headless, khi phiên sẵn sàng, khi tool xong hoặc khi lượt kết thúc; giới hạn tối đa một lần mỗi phút. CLI thiếu hoặc chưa đăng nhập sẽ xóa số liệu Copilot; lỗi khác giữ số gần nhất, nên giao diện có thời điểm cập nhật.

## 6. Thêm CLI mới

Khai báo agent trong `core/agents.ts`, viết launcher và đọc phiên bản trong `core/<agent>/`, rồi thêm backend vào `modules/sessions/backends/`. Cập nhật danh sách agent phía client và thông tin phiên bản ở `/api/info`.

Trước khi nối vào engine, cần kiểm tra bằng CLI thật: tạo/tiếp tục phiên, nhận prompt nhiều dòng, xác nhận tin cậy thư mục, quyền, thứ tự hook, kết thúc lượt và cách đọc transcript. Bài kiểm thử dùng CLI giả không thay thế bước này.

## 7. Lưu ý tương thích CLI

Các kết quả đã quan sát trên Claude Code `2.1.303–2.1.307` và Copilot CLI `1.0.100–1.0.102` trong ngày 19–22/10/2026; cần kiểm tra lại khi nâng phiên bản:

- Claude ghép hooks từ `--settings` với hooks người dùng, nhưng thay `statusLine`; vì vậy TaskPilot phải gọi tiếp lệnh status line cũ. Dữ liệu hạn mức chỉ có sau phản hồi đầu tiên.
- Biến `CLAUDECODE` hoặc `CLAUDE_CODE_CHILD_SESSION` kế thừa từng khiến Claude không lưu transcript. Biến `${VAR}` trong MCP được lấy từ môi trường tiến trình, không phải trường `env` của settings.
- Copilot phát `SessionStart` sau prompt đầu tiên. Backend dùng dấu `/ commands` ở ô nhập để nhận biết sẵn sàng; dấu này thay đổi có thể khiến lần chạy kẹt ở `starting`.
- Hooks Copilot ở cấp repo từng bị loại khi nạp lại plugin trong thư mục chưa tin cậy; hooks cấp user vẫn hoạt động. Cần xác minh lại sau nâng cấp, kể cả khi dùng chế độ hỏi quyền.
- `PermissionRequest` của Copilot có thể đến sau khi tool đã xong; backend trì hoãn báo chờ quyền để loại tín hiệu thừa. `Stop` không có lời nhắn cuối nên cần đọc transcript và chờ ghi đủ cuối lượt.
- Khi Copilot không gửi hook trong một phút, giao diện báo tình trạng này; backend có thể nhận biết kết thúc từ transcript sau 15 giây yên lặng. Hoàn thành thủ công vẫn yêu cầu file đầu ra hợp lệ.
- Đọc hạn mức Copilot phụ thuộc giao thức headless JSON-RPC, đã thử với protocol 3. Nâng CLI cần kiểm tra cả hooks, dấu sẵn sàng và hạn mức.
- Claude giữ subagent khi resume nhưng từng không giữ model truyền bằng flag; model và hooks hoạt động cùng `--agent`. Copilot nhận tên agent/model, nhưng cấu hình thực tế còn phụ thuộc bản CLI và tài khoản.

Leader với CLI thật và khả năng khôi phục dispatch sau khởi động lại cần được kiểm tra khi thay đổi engine; xem các bài E2E [`subtasks.spec.ts`](../e2e/tests/subtasks.spec.ts) và [`run-restart.spec.ts`](../e2e/tests/run-restart.spec.ts) để biết phạm vi kiểm tra tự động.
