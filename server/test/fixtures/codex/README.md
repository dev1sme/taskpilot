# Fixture Codex App Server

Bản ghi JSON-RPC thật của `codex app-server --listen stdio://`, thu bằng `probe.mjs`. Fake app-server và test ánh xạ phát lại các file này; khi đổi phiên bản Codex thì thu lại và so sánh.

- Phiên bản đã kiểm: **`codex-cli 0.163.0`** (Linux x86_64, tài khoản ChatGPT gói Plus), ngày 2026-10-22.
- Model mặc định lúc thu: `gpt-6.1-sol` (theo `~/.codex/config.toml`, `model_reasoning_effort = "high"`).

## Cách chạy lại

```bash
codex --version
# Không tốn quota:
node server/test/fixtures/codex/probe.mjs --scenario handshake --out server/test/fixtures/codex
node server/test/fixtures/codex/probe.mjs --scenario defaults --repo "$(mktemp -d)" --out server/test/fixtures/codex
CODEX_HOME=$(mktemp -d) node server/test/fixtures/codex/probe.mjs --scenario not-logged-in --out server/test/fixtures/codex
# Tốn một lượt ngắn mỗi kịch bản (resume: hai lượt):
node server/test/fixtures/codex/probe.mjs --scenario turn --repo "$(mktemp -d)" --out server/test/fixtures/codex
```

Kịch bản: `handshake`, `defaults`, `turn`, `edit`, `approval-accept`, `approval-decline`, `approval-cancel`, `untrusted`, `auto`, `interrupt`, `busy`, `resume`, `bad-model`, `not-logged-in`, `plan`. `--repo` trống thì probe tạo git repo tạm. `TASKPILOT_CODEX` thay đường dẫn `codex` như server. `--timeout <ms>` mặc định 180000.

Mỗi dòng là `{"dir":"send"|"recv"|"note","msg":…}`. `send` là probe gửi, `recv` là app-server gửi, `note` là ghi chú của probe (pid, kill, tóm tắt cuối). Probe thay đường dẫn repo bằng `<REPO>`, thư mục ngoài workspace bằng `<OUTSIDE>`, `CODEX_HOME` bằng `<CODEX_HOME>`, thư mục tạm bằng `<TMP>`, home bằng `<HOME>`, e-mail bằng `<EMAIL>`, và các id tài khoản/cài đặt bằng `<ID>`.

Probe chạy app-server bằng `--listen stdio://` với môi trường hiện tại, không ghi gì vào `~/.codex` ngoài rollout của thread (xem "Daemon và danh sách resume"). Thư mục "ngoài workspace" nằm trong `~/.cache/taskpilot-codex-probe-*` và bị xoá khi probe kết thúc, vì `workspace-write` cho ghi cả `/tmp` và `$TMPDIR`.

## Thứ tự sự kiện

Handshake: `initialize` → response `{userAgent, codexHome, platformFamily, platformOs}` → client gửi notification `initialized`. App-server có thể gửi `remoteControl/status/changed` trước hoặc sau `initialized`.

Một lượt có tool (`turn.jsonl`, `edit.jsonl`):

```text
send thread/start            → resp {thread:{id,…,source:"vscode",path}, model, approvalPolicy, sandbox:{type:"workspaceWrite",…}}
recv thread/started
send turn/start              → resp {turn:{id, status:"inProgress", items:[]}}
recv thread/status/changed   {type:"active", activeFlags:[]}
recv turn/started
recv item/started|completed  userMessage
recv item/started            agentMessage  (+ item/agentMessage/delta …) → item/completed agentMessage
recv item/started            commandExecution status=inProgress, command="/usr/bin/zsh -lc ls"
recv item/completed          commandExecution status=completed, exitCode, aggregatedOutput
recv item/started|completed  fileChange changes=[{path, kind:{type:"update"|"add"}, diff}]   (chỉ khi model dùng apply_patch)
recv turn/diff/updated
recv thread/tokenUsage/updated {turnId, tokenUsage:{total, last, modelContextWindow}}   (có thể nhiều lần)
recv account/rateLimits/updated
recv item/started|completed  agentMessage  text="DONE", phase="final_answer"
recv thread/status/changed   {type:"idle"}
recv turn/completed          {turn:{status:"completed", items:[agentMessage cuối], itemsView:"summary"}}
```

- Response của request và notification đan xen: response `thread/start` có thể đến trước hoặc sau `thread/started`; response `turn/start` có thể đến sau `thread/status/changed`.
- `turn/completed.turn.items` của lượt `completed` chỉ chứa `agentMessage` cuối (`phase: "final_answer"`), đủ cho `last_assistant_message`. Lượt `interrupted`/`failed` có `items: []`, `itemsView: "notLoaded"`.
- Model thường ghi file bằng lệnh shell (`printf … > probe.txt`) nên chỉ thấy `commandExecution`. Item `fileChange` chỉ xuất hiện khi model dùng apply_patch (`edit.jsonl`).
- Id item: `userMessage` là UUID, `agentMessage` là `msg_…`, `commandExecution` là `exec-…`; `fileChange` cũng có thể mang id `exec-…`.
- Có thêm `item/started|completed` kiểu `reasoning` (`decline`, `plan`), `mcpServer/startupStatus/updated`, `account/updated`, `thread/readState/changed`, `turn/moderationMetadata`, `thread/settings/updated`, `thread/goal/cleared`. Client phải bỏ qua method lạ.
- Một số notification có thêm field `emittedAtMs` không có trong bản sinh `generate-ts`.

## Duyệt quyền

`approval-accept.jsonl`, `approval-decline.jsonl`, `approval-cancel.jsonl` (sandbox `workspace-write`, `on-request`, lệnh `touch` ngoài workspace):

```text
recv item/started                       commandExecution inProgress
recv thread/status/changed              {type:"active", activeFlags:["waitingOnApproval"]}
recv item/commandExecution/requestApproval  id=0 (số), params {kind:"command", threadId, turnId, itemId, reason, command, cwd,
                                        commandActions, proposedExecpolicyAmendment, availableDecisions:["accept",{acceptWithExecpolicyAmendment…},"cancel"]}
send {id:0, result:{decision:"accept"|"decline"|"cancel"}}
recv serverRequest/resolved             {threadId, requestId:0}
```

| Quyết định | Item sau đó                                              | Lượt          |
| ---------- | -------------------------------------------------------- | ------------- |
| `accept`   | `commandExecution` `completed`, lệnh chạy ngoài sandbox  | `completed`   |
| `decline`  | `commandExecution` `declined`, model tiếp tục và trả lời | `completed`   |
| `cancel`   | `commandExecution` `declined`                            | `interrupted` |

- `item/started` của tool đến **trước** server request, như `PreToolUse` → `PermissionRequest` của Claude.
- Id server request là số và đếm riêng từ `0`, có thể trùng id request của client.
- `availableDecisions` không liệt kê `decline` nhưng app-server vẫn nhận `decline`.
- `item/fileChange/requestApproval` (`untrusted.jsonl`) có params `{threadId, turnId, itemId, startedAtMs, reason, grantRoot}`, không có diff; diff nằm ở `item/started` `fileChange` trước đó.

## Ngắt, gửi khi đang chạy, lỗi

- `interrupt.jsonl`: `turn/interrupt {threadId, turnId}` → response `{}` → `thread/status/changed idle` → `turn/completed` `status: "interrupted"`, `error: null`. Lệnh đang chạy (`sleep 60`) **không** có `item/completed`.
- `busy.jsonl`: `turn/start` khi lượt đang chạy không bị từ chối. Response trả **cùng** `turn.id`, không có `turn/started` mới; input được gộp vào lượt đang chạy.
- `bad-model.jsonl`: `thread/start` với model không tồn tại vẫn thành công (response `model` là tên sai) kèm `warning` "Model metadata … not found". Lỗi chỉ đến khi chạy lượt: `error {willRetry:false, error:{message:"…model is not supported when using Codex with a ChatGPT account.", codexErrorInfo:"other"}}` → `turn/completed` `status: "failed"`.
- `not-logged-in.jsonl` (`CODEX_HOME` trống): `account/read` → `{account: null, requiresOpenaiAuth: true}`. `model/list` vẫn trả danh sách model dựng sẵn, `thread/start` vẫn thành công. Lượt phát nhiều `error` với `willRetry: true` ("Reconnecting... n/5", 401), một `warning` chuyển WebSocket sang HTTPS, rồi `error` cuối và `turn/completed` `failed` với `codexErrorInfo.httpConnectionFailed.httpStatusCode = 401`. Mất khoảng 8 giây.
- `resume.jsonl`: lượt 1 nhớ `PELICAN-42`, kill `SIGKILL` tiến trình, mở app-server mới, `thread/resume {threadId, cwd, sandbox, approvalPolicy, excludeTurns:true}` trả cùng thread (`status: idle`), lượt 2 trả lời `PELICAN-42`. `thread/resume` với id không có → lỗi JSON-RPC `-32600` "no rollout found for thread id …".

## Quyền

| Tham số `thread/start`                                              | Kết quả quan sát                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| không ghi đè (`defaults.jsonl`), repo chưa trust                    | `approvalPolicy: "on-request"`, `sandbox: {type:"readOnly"}`                                           |
| không ghi đè, repo đã trust trong `~/.codex/config.toml`            | `approvalPolicy: "on-request"`, `sandbox: {type:"workspaceWrite"}` (không có fixture)                  |
| `workspace-write` + `on-request`                                    | Lệnh và sửa file trong workspace chạy không hỏi. Ghi ngoài workspace → `requestApproval`               |
| `workspace-write` + `untrusted`                                     | Hỏi cả `ls` và tạo file trong workspace (`untrusted.jsonl`)                                            |
| `workspace-write` + `never` (`auto.jsonl`)                          | Không có request nào; model không chạy lệnh ngoài workspace và báo FAILED; file không được tạo         |
| `collaborationMode: {mode:"plan"}` trên `turn/start` (`plan.jsonl`) | Cần `capabilities.experimentalApi: true`. Model từ chối tạo file ("I can't create files in Plan Mode") |

`workspace-write` cho ghi `/tmp` và `$TMPDIR` (`excludeSlashTmp: false`, `excludeTmpdirEnvVar: false`) và tắt mạng (`networkAccess: false`). Response trả `sandbox` dạng `SandboxPolicy` (`{type:"workspaceWrite",…}`), khác chuỗi `SandboxMode` gửi đi.

## Daemon và danh sách resume

- Daemon dùng chung đang chạy (`codex app-server daemon version` → `status: running`, socket `~/.codex/app-server-control/app-server-control.sock`). Tiến trình `codex app-server --listen stdio://` chạy binary standalone, chỉ có socketpair nội bộ, không nối vào socket của daemon (kiểm bằng `ss -xpn`). Stdio độc lập với daemon.
- Thread tạo qua stdio được lưu rollout trong `CODEX_HOME/sessions/…` với `source: "vscode"` và `originator` bằng `clientInfo.name`. `thread/list` với nguồn mặc định (interactive) và lọc theo `cwd` trả các thread này, nên chúng có thể hiện trong `codex resume` của người dùng khi đứng ở cùng repo. `thread/start {ephemeral: true}` không lưu rollout nhưng khi đó không resume được.

## Chưa kiểm

- Item `mcpToolCall` và `webSearch`: `~/.codex/config.toml` không khai báo MCP server (chỉ có `codex_apps` dựng sẵn, thấy qua `mcpServer/startupStatus/updated`) và không bật web search; không prompt nào gọi các tool này.
- `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`.
- Repo đã trust ở chế độ `default`: chỉ có kết quả `thread/start`, không giữ fixture vì `--repo` trỏ vào checkout thật.
