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
  ├─ SessionManager: mọi phiên là PTY (Claude, Copilot, Codex TUI)
  ├─ WorkflowEngine: gửi prompt, kiểm tra đầu ra, chờ duyệt
  ├─ ActivityStore: lưu và phát hoạt động từ hooks
  └─ StateStore: lưu phiên, lần chạy và repo gần nhất
             │
       Claude Code / Copilot CLI / Codex CLI
             ├─ Hooks gọi về /hook/:event bằng curl (mọi phiên)
             └─ codex app-server ngắn hạn qua stdio (chỉ probe và hạn mức Codex)
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

Khi chạy, engine ghi thời điểm, model/cost từ status line Claude hoặc model/token của thread Codex (model từ hook, token từ rollout). Requested model được giữ riêng với model thực tế backend báo; Copilot thiếu số đo thực tế và chi phí. Số liệu đi vào nhật ký, `{{subtasks}}` và cây việc con; sau bàn giao giữ provenance theo session/attempt như [mục 9](#9-metrics-và-bằng-chứng-quota). Run cũ thiếu các trường này vẫn đọc được.

Bảng phân công, trạng thái và câu hỏi việc con được trả về cùng dữ liệu lần chạy. Quy tắc phân tích nằm trong [`assignments.ts`](../server/src/modules/workflow/assignments.ts). Các phiên cùng dùng repo đang mở; kiểm tra phạm vi file không thay thế worktree hay sandbox.

## 4. Tích hợp CLI

Mỗi CLI có một `AgentBackend` trong [`sessions/backends/`](../server/src/modules/sessions/backends), phụ trách khởi chạy, hooks, nhận biết sẵn sàng và chuẩn hóa sự kiện. Mọi phiên chạy TUI của CLI trong `PtyTransport`; người dùng nhập, duyệt quyền và dùng slash command ngay trong terminal. Engine và activity sử dụng tên sự kiện chung như `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`.

- **Claude:** truyền hooks bằng `--settings`, ghép cùng cấu hình người dùng. `statusLine` do TaskPilot chèn gửi mức sử dụng về server rồi gọi tiếp status line của người dùng. Tiếp tục phiên bằng `--resume`.
- **Copilot:** cài hooks tại `$COPILOT_HOME/hooks/taskpilot.json`, mặc định dưới `~/.copilot`. Hooks chỉ chạy cho phiên có biến môi trường TaskPilot phù hợp. `--session-id` dùng cho cả tạo và tiếp tục phiên.
- **Codex:** chạy `codex` TUI; hooks truyền cho từng lần chạy bằng `-c hooks.<Event>=…`, không ghi file của người dùng. Codex không có `--session-id`: native thread id lấy từ `session_id` của hook đầu tiên và khác id session TaskPilot. Tiếp tục bằng `codex resume <thread id>` kèm lại mọi cờ; bàn giao luôn tạo thread mới. Sẵn sàng nhận biết bằng footer ô nhập. Chi tiết ở [Codex TUI](#codex-tui), quyền theo [bảng Codex](CONFIGURATION.md#quyền-và-cấu-hình-codex).
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

Kiểu và helper chung (`Launcher`, `LaunchOptions`, `childEnv`, `agentArgs`) nằm ở [`core/launch.ts`](../server/src/core/launch.ts); đọc `--version` dùng [`core/cli-version.ts`](../server/src/core/cli-version.ts). Thư mục `core/<agent>/` chỉ chứa phần riêng của CLI đó. CLI mới cũng chạy TUI trong PTY và gửi hooks về `/hook/:event`; không có transport riêng theo provider. Phần khác nhau giữa các CLI khai báo trong backend:

| Trường `AgentBackend` | Dùng khi |
|---|---|
| `launcher`, `launchSettings` | Dựng lệnh, cờ quyền/model/subagent và cách truyền hooks |
| `prepare` | Phải cài file trước khi mở (Copilot ghi hooks cấp user) |
| `readyMarker` (`string` hoặc `RegExp`) | CLI chỉ phát `SessionStart` cùng prompt đầu; `PtyTransport` phát `SessionStart` tổng hợp khi thấy dấu |
| `nativeIdOf` | CLI tự cấp id phiên; manager lưu `nativeId` từ hook rồi đổi `session_id` của payload về id TaskPilot |
| `normalize`, `permissionGraceMs`, `finishedTurn` | Payload khác hợp đồng chung, `PermissionRequest` đến muộn, hoặc cần đọc transcript khi thiếu `Stop` |

Trước khi nối vào engine, cần kiểm tra bằng CLI thật: tạo/tiếp tục phiên, nhận prompt nhiều dòng, xác nhận tin cậy thư mục và tin cậy hooks, quyền, thứ tự hook, kết thúc lượt và cách đọc transcript. Bài kiểm thử dùng CLI giả không thay thế bước này.

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
- Chi tiết model/subagent của Copilot: xem [Model và subagent của Copilot](#model-và-subagent-của-copilot).

Leader với CLI thật và khả năng khôi phục dispatch sau khởi động lại cần được kiểm tra khi thay đổi engine; xem các bài E2E [`subtasks.spec.ts`](../e2e/tests/subtasks.spec.ts) và [`run-restart.spec.ts`](../e2e/tests/run-restart.spec.ts) để biết phạm vi kiểm tra tự động.

### Model và subagent của Copilot

Quan sát trên Copilot CLI `1.0.103` ngày 23/10/2026; cần kiểm tra lại khi nâng phiên bản.

- **Truyền vào CLI:** launcher (`core/copilot/launch.ts`) truyền `--agent <Subagent>` và `--model <Model>` từ bảng Phân công. Copilot tự từ chối khi spawn: agent sai → `No such agent: <tên>, available: …`; model sai → `Model "<tên>" from --model flag is not available.` (thoát ngay, không gọi model).
- **Inventory model:** `copilot --acp` → `initialize` + `session/new` trả `models.availableModels[]` (`modelId`, `_meta.copilotEnablement`). `core/copilot/acp.ts` mở phiên ACP tạm trong thư mục tạm (~2 giây, timeout 20 giây), đọc model rồi `session/close`. `session/close` vẫn để lại `~/.copilot/session-state/<id>` (hoặc theo `COPILOT_HOME`), nên client xoá đúng thư mục đó (id phải là UUID). `core/copilot/models.ts` cache 10 phút, single-flight, lỗi không cache, dedupe `auto` (xuất hiện hai lần), bỏ model có `copilotEnablement` khác `enabled`. Phần ACP `models` trong `session/new` [chưa ổn định giữa các bản CLI] nên lỗi chỉ cho trạng thái `unknown`.
- **Custom agent:** `core/copilot/agents.ts` tìm theo đúng nơi Copilot đọc: project `.github/agents/<tên>.agent.md` hoặc `.md`, `.claude/agents/<tên>.md`; user `$COPILOT_HOME|~/.copilot/agents/<tên>.agent.md`. Project thắng user. Không đọc `<project>/.copilot/agents` và `~/.claude/agents`. Chưa xác minh `~/.github/agents` và `.claude/agents/*.agent.md`. Agent built-in/plugin (vd `explore`, `task`) không phải file nên không kiểm được bằng cách này.
- **Probe và preflight:** probe chạy `--version` rồi nạp `capability.models` từ inventory (`source: "model/list"`); đọc lỗi → `models.status = "unknown"` kèm lỗi, không chặn (khác Codex, vì Copilot trước nay chạy được khi không có inventory). Preflight: model không có trong inventory đọc được → chặn `model_unavailable`; tên subagent sai cú pháp → chặn `unsupported_subagent`; không tìm thấy file → chỉ cảnh báo (`subagents = unknown`), Copilot vẫn tự từ chối khi spawn. Cảnh báo này chưa hiện trong bảng Phân công.
- **Leader Copilot:** khi bước chạy bằng Copilot và prompt có `{{subagents}}`, engine thay bằng danh sách custom agent Copilot (`listCopilotAgents`) cùng danh sách model của tài khoản (không đọc được thì ghi `-`), để leader điền bảng Phân công; leader Claude/Codex giữ danh sách Claude/Codex. Policy lane vẫn ép `Agent = copilot`; Model chỉ dùng giá trị trong danh sách hoặc `-`.
- **Test:** vitest đặt `TASKPILOT_COPILOT` trỏ binary không tồn tại để test không đọc tài khoản thật; fixture ACP ghi từ 1.0.103 tại `server/test/fixtures/copilot/acp-handshake.jsonl`. Chưa nghiệm thu một task có việc con Copilot với Subagent/Model hợp lệ trên CLI thật (tốn premium request).

### Codex TUI

Quan sát trên `codex-cli 0.163.0` ngày 26/10/2026; fixture hook, rollout và màn hình thật ở [`server/test/fixtures/codex-tui/`](../server/test/fixtures/codex-tui/README.md). Cần kiểm tra lại khi nâng phiên bản. Mỗi phiên chạy `codex` TUI trong PTY như Claude/Copilot; `SessionMeta.id` là id TaskPilot, `nativeId` là thread id Codex.

Launcher ([`core/codex/launch.ts`](../server/src/core/codex/launch.ts)) dựng lệnh:

```text
codex [resume <nativeId>] --no-daemon -c check_for_update_on_startup=false
      [-m <model>] [-s workspace-write -a on-request|never]
      [-c approvals_reviewer=…] [-c sandbox_workspace_write.network_access=…]
      [-c developer_instructions=…]
      -c hooks.<Event>=[{hooks=[{type="command",command="…"}]}]   # mỗi sự kiện
```

- `--no-daemon` bắt buộc khi có `-c`; thiếu nó TUI chạy embedded và hiện cảnh báo. `check_for_update_on_startup=false` bắt buộc: hộp thoại "Update available" nhận Enter mặc định là **Update now** và chạy script cài đặt.
- Giá trị `-c` là TOML, serialize bằng `smol-toml` ([`core/codex/hooks.ts`](../server/src/core/codex/hooks.ts)); argv không qua shell nên `developer_instructions` nhiều dòng, có `"` hay `\` vẫn giữ nguyên.
- Không có `--session-id`. Resume không giữ model, sandbox hay approval của thread, nên launcher truyền lại đủ cờ. Thread do App Server cũ tạo vẫn resume được bằng TUI. Thiếu `nativeId` thì từ chối resume, không tự tạo thread khác; phiên chưa nhận prompt nào chưa có `nativeId`.
- Resume trong thư mục khác cwd đã ghi của thread làm TUI hỏi chọn thư mục; TaskPilot luôn resume trong repo của phiên nên thường không gặp.

**Hooks.** Lệnh hook giống Claude (`curl` tới `$TASKPILOT_HOOK_URL/<Event>`), cộng guard `TASKPILOT_HOOK_AGENT=codex`. Hook kế thừa env của tiến trình `codex`, nên lệnh tĩnh và mọi giá trị theo phiên đi qua env. Hook `-c` chỉ tồn tại trong lần chạy đó; hooks của người dùng (`~/.codex/hooks.json`) vẫn chạy song song và không bị sửa. Codex chỉ chạy hook đã được tin cậy:

- Hook mới hoặc đổi lệnh làm TUI hiện `Hooks need review` trước ô nhập. Người dùng chọn **Trust all and continue** trong terminal một lần; Codex lưu `trusted_hash` vào `~/.codex/config.toml` theo khóa vị trí (`/<session-flags>/config.toml:<event>:0:0`). Lần sau cùng lệnh thì không hỏi lại.
- Chọn "Continue without trusting" hoặc Esc thì hook chưa tin cậy bị bỏ qua im lặng: không có `Stop`, lane chờ mãi. TaskPilot chưa phát hiện hộp thoại này; người dùng cần xem terminal của phiên.
- TaskPilot không dùng `--dangerously-bypass-hook-trust` vì cờ này bỏ trust cho mọi hook, kể cả hook của người dùng.

**Sẵn sàng và hợp đồng sự kiện.** `SessionStart` chỉ đến cùng prompt đầu (cả khi resume), nên backend dùng `readyMarker` `/·\s*[~/]/`: footer `<model> <effort> · <cwd>` chỉ hiện sau mọi hộp thoại chặn ô nhập (Folder trust, Hooks need review, Update available, Working directory). Chuỗi `Ask Codex to do anything` hiện trước các hộp thoại nên không dùng làm dấu. `PtyTransport` phát `SessionStart` tổng hợp; `SessionStart` thật của Codex bị `normalize` bỏ, nhưng `session_id` của nó vẫn được lưu làm `nativeId`. Manager đổi `session_id` của mọi payload về id TaskPilot trước khi chuyển cho engine/activity.

| Codex gửi | TaskPilot xử lý |
|---|---|
| `PreToolUse`/`PostToolUse` với `tool_name: "apply_patch"` | Đổi thành `Edit`, thêm `tool_input.file_path` từ dòng `*** Add/Update/Delete File:` |
| `PostToolUse` của lệnh lỗi | Vẫn là `PostToolUse`: Codex không có `PostToolUseFailure`, `tool_response` chỉ là text, không có exit code |
| `PermissionRequest` | Bắn ngay sau `PreToolUse`, trước hộp thoại approval; không có `tool_use_id`. Người dùng duyệt trong terminal |
| `Interrupt` (Esc khi đang chạy, không có `Stop`) | Gửi tới `/hook/Stop` với `interrupted: true`; lane về `waiting`, không ghi số đo |
| `Stop` | Kết thúc lượt; `last_assistant_message` là lời nhắn cuối |
| `SessionEnd` | Không đăng ký; SIGTERM không phát sự kiện này |

Trường `permission_mode` trong payload luôn là `"default"`, không phản ánh sandbox/approval thật. Slash command, `$skill` và approval là tính năng của TUI, người dùng gõ/trả lời trực tiếp trong terminal; TaskPilot không còn conversation WebSocket hay REST input/interrupt/approval.

**Số đo và lỗi.** Khi `Stop` không bị ngắt, engine đọc tối đa 1 MiB cuối của `transcript_path` (`~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread id>.jsonl`) và lấy `token_count.info.total_token_usage` cuối cùng (số cộng dồn của thread); model thực tế lấy từ trường `model` của hook. Nguồn số đo vẫn là `codex-thread`. Rollout có thể chưa ghi `token_count` của lượt vừa xong lúc `Stop` bắn [chưa xác minh trên CLI thật]; vì là số cộng dồn, lượt sau tự bù. Không suy ra chi phí USD. Hook không mang tín hiệu lỗi quota/auth có kiểu, nên `quotaDetection` của Codex là `unknown`; `Stop` có `failed` chỉ cho lỗi `unknown`.

**Probe và hạn mức.** TUI không có lệnh tương đương `model/list` hay `account/rateLimits/read`, nên probe/preflight và `QuotaPoller` vẫn mở `codex app-server --listen stdio://` ngắn hạn, chỉ đọc rồi tắt ([`backends/codex.ts`](../server/src/modules/sessions/backends/codex.ts), [`modules/usage/codex.ts`](../server/src/modules/usage/codex.ts)). Probe kiểm `initialize`, `account/read` (vì `model/list` vẫn trả danh sách khi chưa đăng nhập) và `model/list`; không tạo thread/turn. Hạn mức đọc bằng `account/rateLimits/read`; cửa sổ gán theo `windowDurationMins` (300 = 5h, 10080 = 7d), từng trường sai bị bỏ riêng, `UsageStore.applyCodex` merge thưa. Số này không dùng làm quota evidence. Fixture JSON-RPC của app-server ở [`server/test/fixtures/codex/`](../server/test/fixtures/codex/README.md).

Subagent là custom agent `.codex/agents/<tên>.toml` (đọc bằng `smol-toml`); `developer_instructions` và `model` của nó truyền bằng `-c`/`-m` ở mỗi lần mở và resume. Tuỳ chọn YAML `codex:` (`approvals-reviewer`, `network`, chỉ với `acceptEdits`/`auto`) được lưu vào phiên và truyền bằng `-c`. MCP của Codex do chính Codex đọc từ `~/.codex/config.toml`; TaskPilot không hiển thị hay chuyển.

Nghiệm thu qua UI ngày 22/10/2026 (prompt nhiều dòng, Stop, approval, ngắt/resume, workflow tới done, có token thật) chạy trên đường App Server cũ, không áp dụng cho TUI. Luồng TUI hiện được kiểm bằng CLI giả (`server/test/helpers/fake-codex-tui.mjs`) dựng theo fixture; chưa nghiệm thu qua UI với Codex thật.

## 8. Execution và bàn giao

[`execution.ts`](../server/src/modules/workflow/execution.ts) là resolver thuần dùng chung cho preview, prompt, validation Phân công và mọi đường launch/retry. Chọn execution mới theo request → repo → workflow; khi run đã tồn tại chỉ dùng policy đã lưu, không đọc default repo. Cấu hình hiệu lực theo ngoại lệ lane → execution cụ thể → snapshot workflow/dòng Phân công. Schema và ví dụ nằm ở [CONFIGURATION](CONFIGURATION.md#lựa-chọn-execution-và-mặc-định-repo).

`run.workflow` giữ nguyên định nghĩa gốc để so `outdated`; execution, snapshot yêu cầu ban đầu và `laneOverrides` lưu riêng. RunView trả riêng `runMode` từ snapshot để form chạy lại giữ cách chạy cũ kể cả done/cancelled, độc lập cách chạy cho run mới của repo. Ngoại lệ keyed theo step id hoặc dispatch id + số việc; không áp sang bước tương lai. Run thiếu execution theo workflow, field mới optional. Một agent cụ thể cho run không tự sửa bảng phân công: agent/model trái policy bị chặn theo dòng trước approve, launch muộn và retry.

`GET /api/sessions/capabilities` và preflight dùng cùng repo/env/quyền với launch. Codex kiểm initialize, account/read và model/list qua `codex app-server` ngắn hạn, không tạo thread/turn. Claude/Copilot giữ unknown cho login/inventory chưa xác minh. Preflight chặn quyền/subagent không tương thích, không bỏ hạn chế hoặc tự fallback.

### Transaction và ranh giới lane

[`handoff.ts`](../server/src/modules/workflow/handoff.ts) tạo nội dung xác định từ dữ liệu TaskPilot sẵn có: spec/tài liệu và đường dẫn, phạm vi lane, bước/phụ thuộc, prompt/lời nhắn đã lọc, đầu ra thiếu và phần chưa rõ. Khung đầu ra được render riêng từ snapshot hiện tại để không mất bảng Phân công hoặc khung báo cáo khi prompt nguồn thiếu/bị cắt ngắn; preview và prompt mới dùng cùng nội dung đã lọc. Không gọi thêm LLM nguồn, không dump transcript/tool output/env/config. Allowlist, giới hạn kích thước và sanitizer che bí mật đã biết cùng mẫu credential **trước** các bản sao preview, journal, history và prompt mới. Bàn giao không khẳng định phần code đã hoàn tất khi dữ liệu chưa chứng minh.

| API | Hợp đồng chính |
|---|---|
| `POST /api/tasks/:key/run/preview` | `{mode?, execution?}` → cấu hình gốc/hiệu lực, prompt, errors/warnings. |
| `POST /api/tasks/:key/run/handoff/preview` | `{scope, target, reason?}`; scope `{kind: "step", stepId}` hoặc `{kind: "subtask", stepId, n}`; target là execution agent cụ thể. |
| `POST /api/tasks/:key/run/handoff` | Request preview + `previewId`, `fingerprint`, `sourceSessionId`, `expectedGeneration`, `operationId`, `confirmStop`. |

Preview gắn revision/fingerprint của lane và tài liệu liên quan, không dựa toàn bộ run.updatedAt; việc khác tiến triển không tự làm preview hết hiệu lực. Commit kiểm lại scope, nguồn/generation, quyền, target, fingerprint và preflight. Preview cũ trả 409. Cùng operation id/request là idempotent; đổi nội dung dưới cùng id bị từ chối. Hai operation cạnh tranh chỉ một được phép bàn giao.

Reservation khóa resume và nhập terminal của hai phía qua cả REST và WebSocket PTY đang mở. Với nguồn còn chạy/chờ quyền phải có xác nhận dừng/hủy quyền. Barrier chờ transport/process group thoát thật, có deadline; gọi kill hay đóng stdout không được coi là đã thoát. Target id được lưu trước spawn, target dùng session/native thread mới. Sau ready mới bind lane + ngoại lệ + attempt, retire nguồn rồi gửi prompt. Phiên nguồn chỉ đọc lịch sử sau commit.

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

Attempts lưu scope, session/generation, cấu hình yêu cầu, model thực tế nếu có, native id, thời điểm và nguồn số đo. `sessionMetrics` giữ snapshot cumulative theo session: `claude-statusline` cho model/cost, `codex-thread` cho model/token (model từ hook, token từ rollout), `legacy` cho dữ liệu cũ chưa xác minh provenance. Cùng session qua nhiều bước/resume chỉ tính một lần; notification cumulative mới thay số cũ. Tổng counter chỉ xuất hiện nếu mọi session có số đo, luôn kèm coverage; thiếu không thành 0, không suy cost hay quota từ tokens. UI, history và prompt review dùng chung cách tổng hợp.

[`sessions/failure.ts`](../server/src/modules/sessions/failure.ts) chỉ chiếu evidence allowlist, không đưa stderr/backend prose vào DTO. Hiện không backend nào cung cấp lỗi theo lượt có kiểu: `Stop` có `failed` chỉ tạo lỗi `unknown` (`evidence.source: "unclassified"`). Evidence live bị xóa khi prompt/spawn mới; restart không dựng lại nguyên nhân từ transcript hay quota tài khoản cũ.

| Backend / tín hiệu | Phân loại và mức kiểm chứng |
|---|---|
| Codex TUI: hook không có lỗi có kiểu; rollout `rate_limit_reached_type` chưa thấy khác `null` | unknown (`quotaDetection: unknown`); không có fixture tài khoản thật hết quota. |
| Preflight Codex: CLI thiếu / chưa đăng nhập / model không có trong inventory | Chặn trước khi mở phiên (`missing_cli`, `not_logged_in`, `model_unavailable`), không gán quota. |
| Timeout/no-hook/text lạ, `Stop` có `failed` | unknown; không đủ chứng minh hết usage tài khoản. |
| Claude / Copilot failure quota theo lượt | unknown; chưa có adapter/fixture xác minh, vẫn dùng bàn giao thủ công. |
| Claude `/usage` + statusline / Copilot account quota / Codex `account/rateLimits/read` | Quan sát toàn tài khoản, có source/time; tối đa 5 phút, hết hiệu lực sớm khi qua reset. Không dùng làm nguyên nhân lỗi lane. |

Khi có quota evidence phù hợp, UI gợi ý tiếp tục bằng Codex/chọn agent khác/để sau; vẫn qua preview và xác nhận, không tự chuyển, mua quota hay đổi quyền. Hiện chưa backend nào sinh evidence này. Nguồn/version/giới hạn fixture nằm trong [`server/test/fixtures/codex-tui/README.md`](../server/test/fixtures/codex-tui/README.md) (phiên) và [`server/test/fixtures/codex/README.md`](../server/test/fixtures/codex/README.md) (probe/hạn mức). Cách chạy smoke CLI thật có giới hạn và lưu kết quả ở [DEVELOP](DEVELOP.md#smoke-codex-thật-có-giới-hạn).
