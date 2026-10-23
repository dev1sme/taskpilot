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

Kịch bản: `handshake`, `defaults`, `turn`, `edit`, `approval-accept`, `approval-decline`, `approval-cancel`, `untrusted`, `auto`, `git-commit`, `network`, `npm-test`, `interrupt`, `busy`, `resume`, `bad-model`, `not-logged-in`, `plan`. `--repo` trống thì probe tạo git repo tạm. `TASKPILOT_CODEX` thay đường dẫn `codex` như server. `--timeout <ms>` mặc định 180000.

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

### Lệnh thật nào bị hỏi (TPL-035, việc 4)

Kịch bản `git-commit`, `network`, `npm-test` của `probe.mjs` chạy một lệnh thật ở `workspace-write` + `on-request`, chấp nhận mọi `requestApproval` và ghi lại `approvals` (method, reason, command, cwd) trong tóm tắt. **Chưa có `git-commit.jsonl`, `network.jsonl`, `npm-test.jsonl`**: lần chạy ngày 2026-10-23 cả ba lượt `failed` với `usageLimitExceeded` ("hit your usage limit… try again at 6:24 PM") trước khi model chạy lệnh nào, nên không chứng minh được gì về approval. Bản ghi lỗi đã bị xoá để không bị nhầm là fixture; probe giờ ghi `summary.error` khi lượt không `completed`. Chạy lại khi có quota:

```bash
for s in git-commit network npm-test; do
  node server/test/fixtures/codex/probe.mjs --scenario $s --repo "$(mktemp -d)" --out server/test/fixtures/codex
done
```

Chỉ lưu fixture khi `summary.status` là `completed`. Cả ba file phải có `requestApproval` hoặc không có; kết quả đó mới là bằng chứng approval.

Bằng chứng **sandbox** (không qua model, không tốn quota), `codex-cli 0.163.0`, Linux, ngày 2026-10-23, repo git tạm trong `/tmp`, `codex sandbox -c 'sandbox_mode="workspace-write"' -- <lệnh>`:

| Lệnh                                                         | Trong sandbox `workspace-write`                                                      | Hệ quả với `on-request`                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `git commit -m …`                                            | Lỗi `Unable to create '<REPO>/.git/index.lock': Read-only file system`; không commit | Cần chạy ngoài sandbox, **[Suy luận]** model xin `requestApproval` |
| `curl https://example.com`                                   | `Could not resolve host` (mạng tắt)                                                  | Cần chạy ngoài sandbox, **[Suy luận]** model xin `requestApproval` |
| cùng lệnh + `-c sandbox_workspace_write.network_access=true` | HTTP 200                                                                             | Không cần hỏi nữa                                                  |
| `npm test` (script `node -e …`, không mạng, không cài)       | Chạy bình thường, exit 0                                                             | Không bị hỏi                                                       |

Kết luận tạm: (1) `.git` chỉ đọc trong `workspace-write`, nên **mọi `git commit`/`git add` (ghi index) đều ra ngoài sandbox**; `network_access` không giải quyết được việc này, `approvalsReviewer: auto_review` thì có. (2) Mạng tắt là nguyên nhân cho `npm install`, `curl`, `git fetch/push`; `network_access=true` giải quyết. (3) `npm test` thuần cục bộ không bị hỏi. Phần "model có thật sự xin quyền và xin thế nào" (`reason`, `command` của `requestApproval`) vẫn **chưa kiểm chứng** cho tới khi có ba fixture trên; việc 5 chỉ nên chốt `networkAccess`/`approvalsReviewer` sau đó.

## Daemon và danh sách resume

- Daemon dùng chung đang chạy (`codex app-server daemon version` → `status: running`, socket `~/.codex/app-server-control/app-server-control.sock`). Tiến trình `codex app-server --listen stdio://` chạy binary standalone, chỉ có socketpair nội bộ, không nối vào socket của daemon (kiểm bằng `ss -xpn`). Stdio độc lập với daemon.
- Thread tạo qua stdio được lưu rollout trong `CODEX_HOME/sessions/…` với `source: "vscode"` và `originator` bằng `clientInfo.name`. `thread/list` với nguồn mặc định (interactive) và lọc theo `cwd` trả các thread này, nên chúng có thể hiện trong `codex resume` của người dùng khi đứng ở cùng repo. `thread/start {ephemeral: true}` không lưu rollout nhưng khi đó không resume được.

## Chưa kiểm

- Item `mcpToolCall` và `webSearch`: `~/.codex/config.toml` không khai báo MCP server (chỉ có `codex_apps` dựng sẵn, thấy qua `mcpServer/startupStatus/updated`) và không bật web search; không prompt nào gọi các tool này.
- `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`.
- Repo đã trust ở chế độ `default`: chỉ có kết quả `thread/start`, không giữ fixture vì `--repo` trỏ vào checkout thật.

## Failure evidence — TPL-032, việc 12

Ngày 2026-10-23 đã đối chiếu [OpenAI App Server — Errors](https://learn.chatgpt.com/docs/app-server#errors) và sinh schema trực tiếp từ **codex-cli 0.163.0** đang cài, không tạo thread hoặc tiêu quota:

```bash
codex --version
codex app-server generate-ts --out /tmp/tpl032-codex-schema
```

Các file sinh dùng để xác minh: `v2/CodexErrorInfo.ts`, `v2/TurnError.ts`, `v2/ErrorNotification.ts`, `v2/Turn.ts`. Wire enum viết camelCase: `usageLimitExceeded`, `rateLimitExceeded`, `unauthorized`; lỗi kết nối là object như `{httpConnectionFailed:{httpStatusCode:401}}`. Không dùng tên PascalCase trong phần diễn giải docs làm giá trị wire.

| Tín hiệu                                                                                 | Phân loại                              | Mức kiểm chứng                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `turn/completed` failed, đúng thread/turn, `error.codexErrorInfo = "usageLimitExceeded"` | quota                                  | Schema 0.163.0 + fake tổng hợp; **chưa có bản ghi tài khoản thật hết quota** |
| `rateLimitExceeded`, HTTP 429, `sessionBudgetExceeded`                                   | unknown, không suy hết quota tài khoản | Schema 0.163.0 + fake tổng hợp cho rate/429                                  |
| HTTP 401 trong object lỗi kết nối                                                        | auth                                   | Bản ghi thật `not-logged-in.jsonl` + test                                    |
| `unauthorized`                                                                           | auth                                   | Schema 0.163.0 + test tổng hợp                                               |
| `responseStreamConnectionFailed` / `responseStreamDisconnected` với HTTP status null     | network                                | Schema 0.163.0 + fake tổng hợp                                               |
| `bad-model.jsonl` có `codexErrorInfo: "other"`                                           | unknown                                | Bản ghi thật; không parse message để đoán model/quota                        |
| startup `missing`, `notLoggedIn`, `modelUnknown`                                         | cli/auth/model                         | Kiểu lỗi nội bộ từ spawn/account/read/model/list; không gán quota            |

`fake-codex.mjs` nhận `FAILURE:quota|rate|http429|auth|network|unknown|retry|stale`. Đây là fixture tổng hợp dựa trên schema đã kiểm, không phải recording thật. `retry` gửi lỗi có `willRetry:true` rồi hoàn thành thành công; `stale` gửi completion quota khác thread/turn rồi hoàn thành lượt hiện tại. Backend chỉ công bố failure sau completion failed đúng lượt. Text, additionalDetails và stderr không đi vào DTO evidence; chỉ allowlist code/source, timestamp, generation và thread/turn id.

Claude/Copilot chưa có fixture chứng minh lỗi quota theo turn: capability giữ `unknown`, vẫn bàn giao thủ công được. Claude status line và Copilot quota chỉ là quan sát **toàn tài khoản**, có nguồn/thời điểm riêng, tối đa 5 phút và hết hiệu lực sớm khi qua mốc reset; không dùng chúng làm nguyên nhân lỗi của lane. Codex quota detection được khai báo hỗ trợ adapter theo schema, không phải cam kết model/tài khoản thật hoạt động hoặc hết quota. Evidence theo lượt giữ trong live session, xóa khi có prompt/spawn mới; server restart không tái dựng nguyên nhân từ transcript hoặc account usage cũ.
