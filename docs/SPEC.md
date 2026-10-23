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
  ├─ SessionManager: PTY Claude/Copilot; RPC Codex
  ├─ WorkflowEngine: gửi prompt, kiểm tra đầu ra, chờ duyệt
  ├─ ActivityStore: lưu và phát hoạt động từ hooks
  └─ StateStore: lưu phiên, lần chạy và repo gần nhất
             │
       Claude Code / Copilot CLI / Codex CLI
             ├─ Hooks gọi về /hook/:event bằng curl (PTY)
             └─ App Server JSON-RPC qua stdio (Codex)
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

Bảng có thể có thêm cột `Subagent` và `Model`. Khi duyệt gate, `assignments.ts` kiểm cú pháp và model theo agent của dòng (Claude chỉ nhận alias hoặc id `claude-…`), rồi engine kiểm subagent của dòng `claude` bằng `subagentsOf(repo)` (bản project trước bản user): phải tồn tại và có vai trò `member` theo [`library/check.ts`](../server/src/modules/config/library/check.ts). Lỗi nào cũng chặn duyệt. Việc con mở phiên với `--agent`/`--model` tương ứng; `default` và `inherit` không truyền `--model`.

Khi chạy, engine ghi thời điểm, model/cost từ status line Claude hoặc model/token từ Codex thread. Requested model được giữ riêng với model thực tế backend báo; Copilot thiếu số đo thực tế và chi phí. Số liệu đi vào nhật ký, `{{subtasks}}` và cây việc con; sau bàn giao giữ provenance theo session/attempt như [mục 9](#9-metrics-và-bằng-chứng-quota). Run cũ thiếu các trường này vẫn đọc được.

Bảng phân công, trạng thái và câu hỏi việc con được trả về cùng dữ liệu lần chạy. Quy tắc phân tích nằm trong [`assignments.ts`](../server/src/modules/workflow/assignments.ts). Các phiên cùng dùng repo đang mở; kiểm tra phạm vi file không thay thế worktree hay sandbox.

## 4. Tích hợp CLI

Mỗi CLI có một `AgentBackend` trong [`sessions/backends/`](../server/src/modules/sessions/backends), phụ trách khởi chạy, hooks, nhận biết sẵn sàng và chuẩn hóa sự kiện. Engine và activity sử dụng tên sự kiện chung như `SessionStart`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`.

- **Claude:** truyền hooks bằng `--settings`, ghép cùng cấu hình người dùng. `statusLine` do TaskPilot chèn gửi mức sử dụng về server rồi gọi tiếp status line của người dùng. Tiếp tục phiên bằng `--resume`.
- **Copilot:** cài hooks tại `$COPILOT_HOME/hooks/taskpilot.json`, mặc định dưới `~/.copilot`. Hooks chỉ chạy cho phiên có biến môi trường TaskPilot phù hợp. `--session-id` dùng cho cả tạo và tiếp tục phiên.
- **Codex:** App Server JSON-RPC qua stdio; native thread id khác id session TaskPilot. Readiness, approval, lỗi và kết thúc lượt được chuẩn hóa từ RPC, không dùng hooks Claude/Copilot. Resume giữ thread/model; bàn giao luôn tạo thread mới. Quyền theo [bảng Codex](CONFIGURATION.md#quyền-và-cấu-hình-codex).
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

Hạn mức tài khoản của cả ba agent đi qua một lớp [`QuotaPoller`](../server/src/modules/usage/poller.ts); mỗi agent chỉ cung cấp phần đọc và phần ghi vào `UsageStore`. Poller đọc ngay khi khởi động và nền mỗi 5 phút (không cần phiên); hoạt động của phiên agent đó (hook, status line) gọi `request()`, đọc ngay nếu lần đọc trước cách ≥1 phút, không thì đọc một lần vào cuối phút để không lỡ hoạt động cuối. Các lần đọc không chồng nhau; lỗi giữ số gần nhất, nên giao diện có thời điểm cập nhật.

- **Claude:** `claude -p "/usage" --output-format stream-json --verbose --no-session-persistence` chạy ở thư mục tạm với env đã lọc, timeout 15 giây; đọc `usage_report.rate_limits.limits` (`session` → 5h, `weekly_all` → 7d). `usage_report` là tính năng experimental và có thể null (API key, gateway, thiếu scope): khi đó không ghi gì và giữ số cũ. `claude` thiếu thì bỏ qua. `statusLine` vẫn gửi mức sử dụng và là nguồn duy nhất của `spend`; `applyClaude` merge thưa nên không xoá số có sẵn.
- **Copilot:** JSON-RPC `account.getQuota` của tiến trình headless. CLI thiếu hoặc chưa đăng nhập xóa số liệu Copilot; lỗi khác giữ số gần nhất.
- **Codex:** xem mục Codex bên dưới.

Giao diện dùng một model meter và một quy tắc giờ cho mọi agent: giờ reset hôm nay chỉ hiện giờ, khác ngày thì kèm thứ/ngày; cửa sổ đã qua `resetsAt` vẫn hiện số kèm nhãn "có thể đã cũ", không ẩn. Nút ở thanh trạng thái chỉ hiện "Usage" (giữ cảnh báo `is-warn`), chi tiết nằm trong popover.

## 6. Thêm CLI mới

Khai báo agent trong `core/agents.ts`, viết launcher và đọc phiên bản trong `core/<agent>/`, rồi thêm backend vào `modules/sessions/backends/`. Cập nhật danh sách agent phía client và thông tin phiên bản ở `/api/info`.

Trước khi nối vào engine, cần kiểm tra bằng CLI thật: tạo/tiếp tục phiên, nhận prompt nhiều dòng, xác nhận tin cậy thư mục, quyền, thứ tự hook, kết thúc lượt và cách đọc transcript. Bài kiểm thử dùng CLI giả không thay thế bước này.

## 7. Lưu ý tương thích CLI

Các kết quả đã quan sát trên Claude Code `2.1.303–2.1.307` và Copilot CLI `1.0.100–1.0.102` trong ngày 19–22/10/2026; cần kiểm tra lại khi nâng phiên bản:

- Claude ghép hooks từ `--settings` với hooks người dùng, nhưng thay `statusLine`; vì vậy TaskPilot phải gọi tiếp lệnh status line cũ. Dữ liệu status line chỉ có sau phản hồi đầu tiên; 5h/7d còn được poller đọc riêng qua `/usage`.
- Biến `CLAUDECODE` hoặc `CLAUDE_CODE_CHILD_SESSION` kế thừa từng khiến Claude không lưu transcript. Biến `${VAR}` trong MCP được lấy từ môi trường tiến trình, không phải trường `env` của settings.
- Copilot phát `SessionStart` sau prompt đầu tiên. Backend dùng dấu `/ commands` ở ô nhập để nhận biết sẵn sàng; dấu này thay đổi có thể khiến lần chạy kẹt ở `starting`.
- Hooks Copilot ở cấp repo từng bị loại khi nạp lại plugin trong thư mục chưa tin cậy; hooks cấp user vẫn hoạt động. Cần xác minh lại sau nâng cấp, kể cả khi dùng chế độ hỏi quyền.
- `PermissionRequest` của Copilot có thể đến sau khi tool đã xong; backend trì hoãn báo chờ quyền để loại tín hiệu thừa. `Stop` không có lời nhắn cuối nên cần đọc transcript và chờ ghi đủ cuối lượt.
- Khi Copilot không gửi hook trong một phút, giao diện báo tình trạng này; backend có thể nhận biết kết thúc từ transcript sau 15 giây yên lặng. Hoàn thành thủ công vẫn yêu cầu file đầu ra hợp lệ.
- Đọc hạn mức Copilot phụ thuộc giao thức headless JSON-RPC, đã thử với protocol 3. Nâng CLI cần kiểm tra cả hooks, dấu sẵn sàng và hạn mức.
- Claude 2.1.307, spike `--agent`/`--model`: `--agent` vẫn nạp CLAUDE.md và hooks của `--settings` (cả `-p` lẫn interactive), nên không cần chèn mô tả agent vào prompt. `--model` đè `model:` của agent. `--resume` giữ agent nhưng mất `--model`, vì vậy launcher truyền lại cả hai mỗi lần. Agent hoặc model không tồn tại làm Claude và Copilot thoát code 1 ngay khi mở, nên tên phải được kiểm trước khi chạy. Status line có `model.id`, `cost.total_cost_usd`, `cost.total_duration_ms`, `agent.name`.
- Copilot 1.0.102 nhận `--agent`/`--model` và liệt kê agent cả trong `.claude/agents/`. Chưa chạy với model/agent hợp lệ (tốn premium request), nên cấu hình thực tế còn phụ thuộc bản CLI và tài khoản.

Leader với CLI thật và khả năng khôi phục dispatch sau khởi động lại cần được kiểm tra khi thay đổi engine; xem các bài E2E [`subtasks.spec.ts`](../e2e/tests/subtasks.spec.ts) và [`run-restart.spec.ts`](../e2e/tests/run-restart.spec.ts) để biết phạm vi kiểm tra tự động.

### Codex App Server

Tích hợp theo [tài liệu App Server chính thức](https://learn.chatgpt.com/docs/app-server), fixture JSONL thu từ `codex-cli 0.163.0` ngày 22/10/2026 tại `server/test/fixtures/codex/`. Mỗi phiên dùng một tiến trình stdio riêng, độc lập với daemon. `SessionMeta.id` là id TaskPilot; `nativeId` là thread id Codex. Thiếu native id thì từ chối resume, không tự tạo thread khác.

`RpcTransport` chuyển thread/turn/item thành hợp đồng hook chung để engine và activity xử lý; `turn/completed` kết thúc lượt, lỗi `willRetry` không kết thúc sớm. Ngắt hoặc lỗi sẽ đóng tool chưa có `item/completed`. Gửi thêm input khi đang chạy là steering, không tạo `UserPromptSubmit` thứ hai. Token từ `thread/tokenUsage/updated.total` là số tích lũy của thread; không suy ra chi phí USD.

Conversation dùng WebSocket `/api/sessions/:id/conversation` với replay/upsert theo item id và bộ đệm tối đa 2 triệu ký tự, 1.000 item. REST `/input`, `/interrupt`, `/approvals/:requestId` dùng cùng xác thực HTTP. Approval chỉ nhận `accept` hoặc `decline`, giữ đúng id gốc kể cả số `0`; dừng phiên hủy request chưa trả lời. Request tương tác khác (user-input, elicitation, quyền mở rộng) bị từ chối bằng lỗi RPC có thông báo; bản đầu chưa có biểu mẫu cho chúng.

Hạn mức tài khoản lấy từ `account/rateLimits/read` (best effort sau `ready`) và notification `account/rateLimits/updated` (không có `threadId`); cửa sổ gán theo `windowDurationMins` (300 = 5h, 10080 = 7d), từng trường sai bị bỏ riêng, `UsageStore.applyCodex` merge thưa và throttle 60 giây khi số không đổi. Đọc qua `QuotaPoller` chung; không dùng làm quota evidence.

Slash command là tính năng TUI nên `paste()` tự phân giải tập con có RPC tương đương: `/compact` → `thread/compact/start`, `/review` → `review/start`, `/model` → `model/list` rồi lưu model cho `turn/start` sau, `/skills` → `skills/list`, `$name` → `UserInput` loại `skill`; lệnh khác trả lỗi tại chỗ. Subagent là custom agent `.codex/agents/<tên>.toml` (đọc bằng `smol-toml`), `developer_instructions` và `model` đưa vào `thread/start|resume`. Tuỳ chọn `approvalsReviewer`/`networkAccess` (chỉ với sandbox `acceptEdits`/`auto`) đã có ở launch; việc nối từ YAML `codex:` vào phiên chưa hoàn tất. MCP của Codex do chính Codex đọc từ `~/.codex/config.toml`, TaskPilot không hiển thị hay chuyển.

Các giới hạn đã quan sát ở spike: thread tạo qua App Server vẫn xuất hiện trong `codex resume` theo repo; `model/list` vẫn trả danh sách khi chưa đăng nhập nên kiểm thêm `account/read`; `default` phụ thuộc trust của repo. `acceptEdits` và `auto` theo [bảng quyền](CONFIGURATION.md#quyền-và-cấu-hình-codex). Protocol có thể thay đổi khi nâng CLI; cần chạy lại probe và nghiệm thu tích hợp.

Nghiệm thu tích hợp ngày 22/10/2026: Codex 0.163.0 qua UI Chromium đạt prompt nhiều dòng, Stop, accept tạo file/decline không tạo file, ngắt và resume giữ model/thread cùng mã nhớ; workflow Codex thật hoàn tất plan/feedback/gate/dispatch/review/done, có token thật. Đổi sang Claude Code 2.1.308 đã mở đúng PTY/id và gửi prompt đọc báo cáo, nhưng tài khoản Claude hết hạn mức tuần trước khi trả lời; chưa nghiệm thu được phần sinh tổng kết Claude thật trong lần này. Test tự động dùng CLI giả kiểm luồng đổi agent và hồi quy Claude/Copilot.

## 8. Execution và bàn giao

[`execution.ts`](../server/src/modules/workflow/execution.ts) là resolver thuần dùng chung cho preview, prompt, validation Phân công và mọi đường launch/retry. Chọn execution mới theo request → repo → workflow; khi run đã tồn tại chỉ dùng policy đã lưu, không đọc default repo. Cấu hình hiệu lực theo ngoại lệ lane → execution cụ thể → snapshot workflow/dòng Phân công. Schema và ví dụ nằm ở [CONFIGURATION](CONFIGURATION.md#lựa-chọn-execution-và-mặc-định-repo).

`run.workflow` giữ nguyên định nghĩa gốc để so `outdated`; execution, snapshot yêu cầu ban đầu và `laneOverrides` lưu riêng. RunView trả riêng `runMode` từ snapshot để form chạy lại giữ cách chạy cũ kể cả done/cancelled, độc lập cách chạy cho run mới của repo. Ngoại lệ keyed theo step id hoặc dispatch id + số việc; không áp sang bước tương lai. Run thiếu execution theo workflow, field mới optional. Một agent cụ thể cho run không tự sửa bảng phân công: agent/model trái policy bị chặn theo dòng trước approve, launch muộn và retry.

`GET /api/sessions/capabilities` và preflight dùng cùng repo/env/quyền với launch. Codex kiểm initialize, account/read và model/list riêng, không tạo thread/turn. Claude/Copilot giữ unknown cho login/inventory chưa xác minh. Preflight chặn quyền/subagent không tương thích, không bỏ hạn chế hoặc tự fallback.

### Transaction và ranh giới lane

[`handoff.ts`](../server/src/modules/workflow/handoff.ts) tạo nội dung xác định từ dữ liệu TaskPilot sẵn có: spec/tài liệu và đường dẫn, phạm vi lane, bước/phụ thuộc, prompt/lời nhắn đã lọc, đầu ra thiếu và phần chưa rõ. Khung đầu ra được render riêng từ snapshot hiện tại để không mất bảng Phân công hoặc khung báo cáo khi prompt nguồn thiếu/bị cắt ngắn; preview và prompt mới dùng cùng nội dung đã lọc. Không gọi thêm LLM nguồn, không dump transcript/tool output/env/config. Allowlist, giới hạn kích thước và sanitizer che bí mật đã biết cùng mẫu credential **trước** các bản sao preview, journal, history và prompt mới. Bàn giao không khẳng định phần code đã hoàn tất khi dữ liệu chưa chứng minh.

| API | Hợp đồng chính |
|---|---|
| `POST /api/tasks/:key/run/preview` | `{mode?, execution?}` → cấu hình gốc/hiệu lực, prompt, errors/warnings. |
| `POST /api/tasks/:key/run/handoff/preview` | `{scope, target, reason?}`; scope `{kind: "step", stepId}` hoặc `{kind: "subtask", stepId, n}`; target là execution agent cụ thể. |
| `POST /api/tasks/:key/run/handoff` | Request preview + `previewId`, `fingerprint`, `sourceSessionId`, `expectedGeneration`, `operationId`, `confirmStop`. |

Preview gắn revision/fingerprint của lane và tài liệu liên quan, không dựa toàn bộ run.updatedAt; việc khác tiến triển không tự làm preview hết hiệu lực. Commit kiểm lại scope, nguồn/generation, quyền, target, fingerprint và preflight. Preview cũ trả 409. Cùng operation id/request là idempotent; đổi nội dung dưới cùng id bị từ chối. Hai operation cạnh tranh chỉ một được phép bàn giao.

Reservation khóa input/resume/approval của hai phía qua cả REST và WebSocket đang mở. Với nguồn còn chạy/chờ quyền phải có xác nhận dừng/hủy quyền. Barrier chờ transport/process group thoát thật, có deadline; gọi kill hay đóng stdout không được coi là đã thoát. Target id được lưu trước spawn, target dùng session/native thread mới. Sau ready mới bind lane + ngoại lệ + attempt, retire nguồn rồi gửi prompt. Phiên nguồn chỉ đọc lịch sử sau commit.

Journal lưu bền vững qua `prepared` → `source-stopped` → `target-created` → `committed` hoặc `failed`; giao prompt có `pending` → `sending` → `sent`. Lỗi ghi state dừng side effect kế tiếp. Không archive, đổi stepIndex, bỏ gate, chạy lại việc done hay thay phụ thuộc. Bàn giao chỉ áp dụng lane đã bắt đầu, đang starting/running/waiting/interrupted trong run hoạt động; done/cancelled/gate/pending và lane bị khóa không được chuyển.

### Recovery và đầu ra

| Tình huống | Hành vi phục hồi |
|---|---|
| Preflight fail | Chưa reserve/dừng nguồn; sửa cấu hình và preview lại. |
| Chưa commit, target startup fail | Dừng/dọn target, giữ journal lỗi; nguồn vẫn là lane hiện hành, không tự resume. Người dùng retry nguồn hoặc tạo operation mới. |
| Đã commit, gửi prompt lỗi hoặc không rõ đã gửi | Giữ đích hiện hành, không tự replay; retry có chủ đích ở đích. Xác nhận HTTP không rõ dùng lại cùng operation id. |
| Server restart | Đọc journal và metadata, kiểm process ownership/generation, dừng các writer còn tồn tại trước unlock; trước commit về nguồn, sau commit giữ đích, đánh dấu interrupted. |
| Không chứng minh được ownership/exit hoặc cleanup timeout | `cleanup/recovery: blocked`, khóa lane; không mở thêm writer. Cần kiểm tra/dọn đúng tiến trình rồi retry. |

Process ownership dùng PID + identity/thời điểm khởi tạo (Linux boot id + start ticks), tránh giết PID đã tái dùng. Callback/timer/hook/exit/approval/metrics được kiểm session/attempt/process generation; sự kiện nguồn muộn không hoàn thành lane hoặc cập nhật đích. Baseline metadata/content fingerprint được chụp sau khi nguồn dừng và trước input đích; file cũ sát cửa sổ mtime hoặc ghi lúc startup trước prompt không đủ `done-when`. Vẫn cần đầu ra mới và tín hiệu hoàn tất thành công từ attempt hiện hành; manual complete cũng kiểm đầu ra.

## 9. Metrics và bằng chứng quota

Attempts lưu scope, session/generation, cấu hình yêu cầu, model thực tế nếu có, native id, thời điểm và nguồn số đo. `sessionMetrics` giữ snapshot cumulative theo session: `claude-statusline` cho model/cost, `codex-thread` cho model/token, `legacy` cho dữ liệu cũ chưa xác minh provenance. Cùng session qua nhiều bước/resume chỉ tính một lần; notification cumulative mới thay số cũ. Tổng counter chỉ xuất hiện nếu mọi session có số đo, luôn kèm coverage; thiếu không thành 0, không suy cost hay quota từ tokens. UI, history và prompt review dùng chung cách tổng hợp.

[`sessions/failure.ts`](../server/src/modules/sessions/failure.ts) chỉ chiếu evidence allowlist, không đưa stderr/backend prose vào DTO. Lỗi đúng thread/turn đã hoàn tất failed mới trở thành bằng chứng; willRetry hoặc sự kiện stale không chốt nguyên nhân. Evidence live bị xóa khi prompt/spawn mới; restart không dựng lại nguyên nhân từ transcript hay quota tài khoản cũ.

| Backend / tín hiệu | Phân loại và mức kiểm chứng |
|---|---|
| Codex failed đúng thread/turn, `codexErrorInfo: "usageLimitExceeded"` | quota; adapter supported theo schema CLI 0.163.0 và fake tổng hợp. Chưa có recording tài khoản thật hết quota. |
| Codex `unauthorized` / connection HTTP 401 | auth; HTTP 401 có fixture thật, enum unauthorized theo schema. |
| Codex stream disconnected/connection failed, HTTP status null | network theo schema, test tổng hợp. |
| Startup missing / notLoggedIn / modelUnknown | cli / auth / model từ kiểm tra startup, không gán quota. |
| `rateLimitExceeded`, HTTP 429, session budget, timeout/no-hook/text lạ | unknown; không đủ chứng minh hết usage tài khoản. |
| Claude / Copilot failure quota theo lượt | unknown; chưa có adapter/fixture xác minh, vẫn dùng bàn giao thủ công. |
| Claude `/usage` + statusline / Copilot account quota | Quan sát toàn tài khoản, có source/time; tối đa 5 phút, hết hiệu lực sớm khi qua reset. Không dùng làm nguyên nhân lỗi lane. |

Khi có quota evidence phù hợp, UI gợi ý tiếp tục bằng Codex/chọn agent khác/để sau; vẫn qua preview và xác nhận, không tự chuyển, mua quota hay đổi quyền. Nguồn/version/giới hạn fixture nằm trong [`server/test/fixtures/codex/README.md`](../server/test/fixtures/codex/README.md). Cách chạy smoke CLI thật có giới hạn và lưu kết quả ở [DEVELOP](DEVELOP.md#smoke-codex-thật-có-giới-hạn).
