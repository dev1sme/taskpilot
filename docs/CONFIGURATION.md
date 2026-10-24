# Cấu hình TaskPilot

## Biến môi trường

TaskPilot đọc `.env` cạnh `package.json` của chính ứng dụng, kể cả khi khởi chạy từ repo khác. Thứ tự ưu tiên: tùy chọn CLI → môi trường tiến trình → `.env` → mặc định. Xem mẫu tại [`.env.example`](../.env.example).

| Biến                                                         | Mặc định / ý nghĩa                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TASKPILOT_HOST` / `TASKPILOT_PORT`                          | `127.0.0.1` / `8790`; có thể ghi đè bằng `--host` / `--port`                                                          |
| `TASKPILOT_HOME`                                             | `~/.taskpilot`; nơi lưu trạng thái, bản sao lưu và dữ liệu xác thực                                                   |
| `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD`            | Tài khoản đăng nhập; đặt cả hai hoặc để trống cả hai                                                                  |
| `TASKPILOT_TOKEN`                                            | Token cố định thay cho token ngẫu nhiên; khi dùng tài khoản, đây là token API tùy chọn cho header `x-taskpilot-token` |
| `TASKPILOT_ALLOWED_HOSTS`                                    | Danh sách hostname bổ sung được chấp nhận, phân cách bằng dấu phẩy                                                    |
| `TASKPILOT_CLAUDE` / `TASKPILOT_COPILOT` / `TASKPILOT_CODEX` | Lệnh CLI; mặc định `claude` / `copilot` / `codex`                                                                     |
| `TASKPILOT_CLAUDE_HOME` / `TASKPILOT_CLAUDE_JSON`            | Nơi TaskPilot đọc cấu hình Claude; mặc định `~/.claude` / `~/.claude.json`                                            |
| `TASKPILOT_CODEX_HOME`                                       | Ghi đè nơi TaskPilot đọc cấu hình Codex, hữu ích cho kiểm thử; mặc định dùng `CODEX_HOME` hoặc `~/.codex`             |
| `TASKPILOT_CODEX_SKILLS_HOME`                                | Ghi đè thư mục skills cá nhân Codex khi kiểm thử; mặc định là `~/.agents/skills`, độc lập với `CODEX_HOME`          |
| `TASKPILOT_COPILOT_HOME`                                     | Ghi đè nơi TaskPilot đọc cấu hình Copilot, hữu ích cho kiểm thử; mặc định dùng `COPILOT_HOME` hoặc `~/.copilot`       |
| `COPILOT_HOME`                                               | Thư mục cấu hình Copilot, gồm hooks; mặc định `~/.copilot`                                                            |

Đăng nhập, reverse proxy và giới hạn truy cập được mô tả tại [Triển khai](DEPLOY.md).

## Cấu hình CLI và MCP

Trang Cấu hình có bộ chọn Claude, Copilot, Codex trong URL (`?cli=...`). URL và API cũ không có `cli` vẫn chọn Claude. Khi chọn Copilot hoặc Codex, trang mở biểu mẫu native cho các nhóm được hỗ trợ và báo rõ nhóm chưa hỗ trợ. **Workflow**, định dạng tài liệu và Codegraph là trang chung, không đổi theo CLI đang chọn. Việc chọn CLI ở Cấu hình không đổi agent/model hay quyền của lane đang chạy.

| Nhóm              | Claude                                                                            | Copilot                                                                                            | Codex                                                                 |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Hướng dẫn         | `CLAUDE.md`, `CLAUDE.local.md`, `~/.claude/CLAUDE.md`                             | `.github/copilot-instructions.md`, `~/.copilot/copilot-instructions.md`                            | `AGENTS.md`, `~/.codex/AGENTS.md`                                     |
| Settings          | `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json` | `.github/copilot/settings.json`, `.github/copilot/settings.local.json`, `~/.copilot/settings.json` | `.codex/config.toml`, `~/.codex/config.toml`                          |
| Hooks             | Trong settings Claude                                                             | `.github/hooks/*.json`, `~/.copilot/hooks/*.json`                                                  | Chưa có adapter hooks đã xác minh                                     |
| Agents            | `.claude/agents`, `~/.claude/agents`                                              | `.github/agents`, `~/.copilot/agents`; `.claude/agents` chỉ xem                                    | `.codex/agents/*.toml` trong repo                                     |
| Commands / skills | `.claude/commands` và `.claude/skills` ở project/user                             | Không có commands; skills ở `.github/skills`, `~/.copilot/skills`                                  | Không có commands; skills ở `.agents/skills`, `~/.agents/skills`       |
| MCP               | `.mcp.json`, `~/.claude.json` (project/local/user)                                | Đọc `.mcp.json`; ghi `.github/mcp.json`, `~/.copilot/mcp-config.json`                              | Bảng `mcp_servers` trong `.codex/config.toml`, `~/.codex/config.toml` |

Vị trí skills cá nhân của Codex theo [tài liệu Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) là `~/.agents/skills`, độc lập với `CODEX_HOME`.

API native hỗ trợ đọc, xem diff, ghi có hash và backup cho các nhóm có đường dẫn ở bảng; chỉ các trường settings đã validate được chỉnh. Copilot hooks dùng file JSON schema version 1. Codex và Copilot MCP có project/user; `.mcp.json` là nguồn Copilot chỉ xem. Chỉ Claude có thao tác kiểm kết nối MCP qua CLI và kho env cho secret project; MCP native ghi giá trị vào file CLI. Không nhập secret nếu không muốn nó nằm trong file native. Cấu hình mới có hiệu lực theo cách CLI nạp lại, không bảo đảm đổi phiên đang chạy.

Các trang cấu hình cho phép chỉnh `CLAUDE.md`, settings, quyền, hooks, agents, commands, skills và MCP theo phạm vi project, local hoặc user. Mỗi lần lưu đều có bản so sánh trước khi ghi, kiểm tra xung đột và sao lưu để khôi phục từ **Lịch sử thay đổi**. Nếu file đã đổi bên ngoài, tải lại trước khi sửa tiếp.

**Thư viện** chia agents, commands và skills theo thư mục. Các mục trùng tên bị che bởi phạm vi ưu tiên cao hơn sẽ được đánh dấu:

| Loại             | Thứ tự ưu tiên từ cao xuống thấp |
| ---------------- | -------------------------------- |
| MCP              | Local → project → user           |
| Agents           | Project → user                   |
| Skills, commands | User → project                   |

MCP project nằm trong `.mcp.json`; local và user nằm trong `~/.claude.json` và được sửa thông qua `claude mcp`. Với MCP dùng chung, đánh dấu giá trị là bí mật để lưu `${VAR}` trong file, còn giá trị thật nằm trong kho môi trường của TaskPilot. Các phiên do TaskPilot mở nhận biến này; phiên CLI tự mở cần biến tương ứng trong shell. Giá trị bí mật được che trước khi trả về trình duyệt.

TaskPilot cung cấp các mẫu subagent tại [`subagents/claude/`](../subagents/claude); cách ghi và kiểm tra nằm ở [Subagent và model](#subagent-và-model).

## Agent và model

`agent` chọn CLI: `claude`, `copilot` hoặc `codex`. Trong chế độ **Theo cấu hình workflow**, `model` từng bước ghi đè giá trị chung; khi bước sau đổi agent/model, TaskPilot tạo phiên mới và chuyển bối cảnh qua tài liệu cùng nhật ký. Lựa chọn agent cụ thể ở form áp dụng quy tắc execution dưới đây.

Workflow `default` dùng Claude điều tra và Copilot triển khai khi theo workflow. Để dùng một CLI cho mọi bước, chọn **Agent** tại task. Nếu muốn giữ phối hợp CLI và chỉ đổi bước implement sang Claude, tạo `.taskpilot/workflow.yml`:

```yaml
extends: default
steps:
  - id: implement
    agent: claude
```

Thêm `model: sonnet` vào một bước để chọn model Claude cho bước đó. Bỏ `model`, hoặc dùng `default` / `inherit`, để CLI dùng model mặc định. Model Copilot phụ thuộc tài khoản; không mặc định coi alias của Claude là model Copilot hợp lệ. Nếu đặt model chung rồi đổi CLI ở một bước, nên đặt model riêng cho bước ấy.

### Lựa chọn execution và mặc định repo

Workflow và execution là hai lựa chọn độc lập. Request bắt đầu/chạy lại có dạng:

```json
{ "mode": "leader", "execution": { "agent": "codex" } }
```

`execution` là `{agent: "workflow"}` hoặc `{agent: "claude" | "copilot" | "codex", model?: string}`. Chế độ workflow không nhận `model`. Với agent cụ thể, bỏ `model` nghĩa là không truyền model cho CLI, kể cả YAML có model; không mặc định thành `sonnet`. `default`/`inherit` được chuẩn hóa thành không truyền model. Model cụ thể phải hợp lệ với CLI và qua preflight trong khả năng backend.

Mặc định repo lưu tại `.taskpilot/settings.yml`, có thể commit để chia sẻ:

```yaml
mode: leader
executionVersion: 1
execution:
  agent: codex
# Thêm model: <id từ inventory của tài khoản> nếu muốn cố định model.
```

| Phạm vi                     | Thứ tự ưu tiên / hành vi                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chọn execution cho run mới  | Request có execution → execution của repo → `{agent: workflow}`. Lựa chọn request là đầy đủ, không ghép model từ repo.                            |
| Chọn mode                   | Mode request → mode repo → mode mặc định theo cấu hình/override hiện có. Mode và execution không thay thế nhau.                                   |
| Agent/model của lane        | Ngoại lệ bàn giao đúng lane → execution cụ thể đã lưu trong run → bước YAML hoặc dòng Phân công trong snapshot.                                   |
| Run cũ                      | Không có execution nghĩa là workflow; không đọc mặc định repo mới. Run rất cũ chưa có workflow snapshot giữ đường tải workflow tương thích cũ.    |
| Retry/reload/server restart | Giữ policy và ngoại lệ của run. **Chạy lại từ đầu** tạo run mới, form khởi tạo từ lựa chọn run trước; không mang ngoại lệ từng lane sang run mới. |

API `GET/PUT /api/config/workflow/execution-defaults` đọc/lưu mặc định. PUT nhận `execution` và `baseHash`; `execution: null` xóa mặc định execution (khác với lựa chọn workflow có chủ đích). Lưu agent/model và lưu mode là hai thao tác riêng, đều có kiểm xung đột và backup. Writer vá YAML AST, giữ comments/unknown fields khi sửa field khác; settings chỉ có `mode` vẫn hợp lệ. Execution/version sai được báo lỗi để sửa, không âm thầm fallback. Chọn hoặc bàn giao không sửa workflow YAML hay cấu hình CLI người dùng.

`run.workflow` giữ snapshot gốc; `executionSnapshot.version: 1` giữ lựa chọn/nguồn và cấu hình yêu cầu ban đầu. `laneOverrides` dùng khóa JSON tuple `["step", stepId]` hoặc `["subtask", dispatchStepId, n]`; mỗi giá trị lưu scope, execution cụ thể, operationId và thời điểm. Định dạng nội bộ phục vụ recovery, không chỉnh trực tiếp `state.json` khi server đang chạy.

Preview, prompt, validation bảng, launch muộn và retry dùng chung resolver. Với execution cụ thể, mọi dòng Phân công phải khớp agent/model của run; model mặc định dùng `-`. Sai dòng nào báo số việc/field dòng đó; không tự chuẩn hóa bảng. Bàn giao chỉ tạo ngoại lệ đúng bước hoặc việc con, không đổi policy bước tương lai.

### Khả năng kiểm chứng model

`GET /api/sessions/capabilities` trả capability theo repo/env với trạng thái `supported`, `unsupported` hoặc `unknown` và nguồn kiểm chứng. Preflight không tạo thread/turn, không phải lượt LLM thử.

| Backend | Picker / kiểm chứng trước khi chạy                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude  | Picker chỉ Mặc định; kiểm CLI, cú pháp model/quyền; chưa xác minh đầy đủ login và inventory tài khoản. Giữ model YAML/bảng khi theo workflow.                                  |
| Copilot | Picker chỉ Mặc định; kiểm CLI, cú pháp model/quyền; chưa có inventory/login đã xác minh. Tên hợp cú pháp không chứng minh tài khoản dùng được.                                 |
| Codex   | `initialize` kiểm CLI/protocol, `account/read` kiểm đăng nhập riêng, `model/list` cấp inventory. Danh sách model có thể tồn tại khi logout, nên không dùng nó thay kiểm login. |

Thiếu CLI, logout Codex, inventory không đọc được cho model Codex cụ thể, model không có trong inventory hoặc quyền không hỗ trợ đều chặn trước khi đổi lane. Trạng thái `unknown` được hiển thị rõ; runtime vẫn có thể thất bại và không tự chọn CLI/model khác. Cấu hình yêu cầu hiệu lực khác model thực tế: model thực tế chỉ được ghi khi backend báo.

### Quyền và cấu hình Codex

Codex dùng App Server qua stdio, cấu hình và đăng nhập Codex hiện có. Adapter cấu hình có thể đọc và vá các trường settings đã validate cùng bảng MCP trong `.codex/config.toml` và `~/.codex/config.toml`; giao diện Codex mở biểu mẫu này. TaskPilot không chuyển hooks, MCP, settings hoặc subagent Claude sang Codex. Cột `Subagent` của dòng Codex là tên file trong `.codex/agents/` (không kèm `.toml`) hoặc `-` ([xem Subagent Codex](#subagent-codex)). Menu **+** dùng model mặc định; workflow và bảng phân công có thể đặt model. Model thực tế của phiên được lưu cùng native thread id để tiếp tục đúng model.

| `permission-mode`    | Sandbox Codex              | Approval policy     |
| -------------------- | -------------------------- | ------------------- |
| Bỏ trống / `default` | Theo cấu hình Codex        | Theo cấu hình Codex |
| `acceptEdits`        | `workspace-write`          | `on-request`        |
| `auto`               | `workspace-write`          | `never`             |
| `plan`               | Bị từ chối trong TaskPilot | —                   |

`acceptEdits` của Codex cho phép lệnh trong sandbox chạy mà không hỏi, chỉ xin quyền vượt sandbox; khác với quyền cùng tên của Claude. `auto` vẫn chịu sandbox và không tự mở quyền bên ngoài. Plan mode của Codex là API thử nghiệm và không viết được tài liệu đầu ra, nên chưa hỗ trợ. Chế độ mặc định giữ quyền của cấu hình người dùng. TaskPilot không đặt `danger-full-access` hoặc cờ `--dangerously-*`.

#### Giảm chờ quyền (tùy chọn)

Mặc định không đổi. Probe sandbox với `codex-cli 0.163.0` (`codex sandbox`, `workspace-write`) cho thấy: `.git` chỉ đọc nên `git commit` luôn phải xin quyền ngoài sandbox; mạng tắt nên `curl`/tải gói bị chặn; `npm test` cục bộ chạy không cần hỏi. Ba lượt probe qua model chưa hoàn tất do hết quota Codex, nên chưa có fixture thật cho nội dung `requestApproval`. Hai khoá tùy chọn dưới đây chỉ có tác dụng với `acceptEdits`/`auto`; ở `default` Codex dùng cấu hình của bạn:

```yaml
codex:
  approvals-reviewer: auto_review # user (mặc định) | auto_review
  network: true # false (mặc định)
```

- `approvals-reviewer: auto_review` để Codex tự rà các yêu cầu quyền thay vì hỏi người dùng; đây là cách giảm hỏi cho lệnh git.
- `network: true` bật `sandbox_workspace_write.network_access`; chỉ giải quyết mạng, không giải quyết `.git` chỉ đọc.
- Khoá đặt ở đầu workflow hoặc từng bước (kể cả `dispatch`); bước ghi đè từng trường. Khoá/giá trị lạ (ví dụ `sandbox`) là lỗi; không có đường nào dẫn tới `danger-full-access`. Có cảnh báo khi đặt `codex:` mà `permission-mode` không phải `acceptEdits`/`auto`, hoặc không có bước Codex nào.
- Giá trị của lane được lưu vào phiên (`codex`) và truyền vào `thread/start`/`thread/resume`; đổi giá trị giữa các bước thì mở phiên mới. Chưa kiểm với Codex thật vì hết quota lúc probe.

### Slash command của Codex

App Server không có slash command (đó là tính năng TUI). Ô nhập phiên Codex tự phân giải tập con có RPC tương đương: `/compact`, `/review [branch <tên>|commit <sha>|<hướng dẫn>]`, `/model [id]` (kiểm `model/list`, áp dụng cho các lượt sau), `/skills`, và `$tên-skill …`. Lệnh khác (`/xyz`) báo rõ là chỉ có trong TUI Codex và không gửi cho model; đường dẫn như `/home/x` và `$HOME` được gửi nguyên văn.

### Nút usage (Claude, Copilot, Codex)

Nút ở thanh trạng thái chỉ hiện chữ "Usage" (đổi sang cảnh báo khi một cửa sổ gần hết); chi tiết nằm trong popover. Cả ba agent dùng chung cách hiện: mỗi cửa sổ có % đã dùng và giờ reset, hôm nay chỉ hiện giờ, khác ngày kèm thứ/ngày. Cửa sổ đã qua giờ reset vẫn hiện số kèm nhãn "có thể đã cũ". Cửa sổ thiếu thì không hiện và không đoán; không suy quota từ phần trăm. Đây là số toàn tài khoản, không gán cho task.

- **Claude:** cửa sổ 5h và 7d lấy từ `claude -p "/usage"` (không tốn token), chi phí phiên (`spend`) từ status line. Nếu bản Claude không trả `usage_report` (API key, gateway, thiếu scope) thì giữ số từ status line/lần đọc trước.
- **Copilot:** premium requests, giờ reset theo đơn vị (`premium requests reset lúc …`).
- **Codex:** cửa sổ 5h và 7d, gói, credits, từ `account/rateLimits/read` và `account/rateLimits/updated`.

Số liệu làm tươi khi khởi động server, nền mỗi 5 phút và khi agent đó có hoạt động (tối đa một lần mỗi phút), nên không cần phiên đang chạy.

## Subagent và model

Subagent Claude là file Markdown trong `.claude/agents/` (project) hoặc `~/.claude/agents/` (user); khi trùng tên, bản project được dùng. Leader Claude dùng subagent theo hai cách; leader CLI khác dùng công cụ của CLI đó:

- **Dò code:** gọi subagent có vai trò `leader` bằng Task tool trong phiên của mình, nên chọn model rẻ.
- **Làm việc con:** ghi tên subagent `member` vào cột `Subagent` của bảng Phân công. Phiên của việc con mở bằng `claude --agent <subagent>`; tools, prompt và model do subagent quyết định. Cờ này chỉ dùng cho dòng `claude`, dòng `copilot` chỉ nhận `--agent` nếu cột có giá trị và không được kiểm tên.

Cột `Model` ghi đè `model:` của subagent bằng `--model`. `default` hoặc `inherit` không truyền `--model`. Giá trị hợp lệ theo CLI của dòng:

| Agent     | Model hợp lệ                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`  | `default`, `inherit`, `haiku`, `sonnet`, `opus`, `fable`, `opusplan`, hoặc id `claude-…`; `haiku`/`sonnet`/`opus`/`fable` và id nhận thêm hậu tố `[1m]` |
| `copilot` | Một từ bất kỳ, không bắt đầu bằng `-`; TaskPilot không kiểm tên model                                                                                   |
| `codex`   | Model từ `model/list` của tài khoản; kiểm trước khi mở phiên và khi duyệt bảng phân công                                                                |

Cùng quy tắc áp dụng cho `model` trong `workflow.yml` ở cấp chung và cấp bước (không áp dụng cho bước `dispatch`; model của việc con lấy từ bảng). Bước chạy `agent` khác agent chung mà thừa hưởng model chung không hợp lệ cho agent của bước sẽ bị chặn; hãy đặt model riêng cho bước đó. Override `extends` vá được `model` của workflow và của từng bước.

### Subagent Codex

Codex hỗ trợ custom agent là file TOML trong `<repo>/.codex/agents/<tên>.toml` (cần `name`, `description`, `developer_instructions`; tùy chọn `model`, `sandbox_mode`, `model_reasoning_effort`). Mẫu của TaskPilot nằm ở [`subagents/codex/`](../subagents/codex) và cài qua trang **Agents** (chọn CLI Codex) với preview diff, backup và chống ghi đè như `.claude/agents`.

- **Việc con:** ghi tên file vào cột `Subagent` của dòng `codex`. TaskPilot đưa `developer_instructions` vào `thread/start|resume`; model của dòng thắng, nếu không dùng `model` của agent, nếu không nữa giữ model mặc định. Thiếu file, TOML hỏng hoặc không có `developer_instructions` chặn ở preflight (`unsupported_subagent`). Chỉ cột `Subagent` ghi tên TOML thật; `explorer`/`worker` built-in của Codex không điền vào cột này.
- **Leader Codex:** yêu cầu trực tiếp Codex dùng subagent (built-in `explorer`/`worker` hoặc custom agent) khi cần dò rộng hoặc song song. Subagent kế thừa quyền của phiên và tốn thêm token.
- `{{subagents}}` hiện chỉ liệt kê subagent Claude; leader Codex tự xem `.codex/agents/`.

### Mẫu subagent

Repo chưa có subagent nào trong `.claude/agents/` thì trang **Agents** hiện banner với nút **Ghi subagent mẫu của TaskPilot**; nút **Subagent mẫu** trên thanh công cụ vẫn dùng được khi repo đã có agent. Bộ mẫu (tiếng Anh, tiền tố `taskpilot-`):

| Subagent                | Model    | Vai trò                                          |
| ----------------------- | -------- | ------------------------------------------------ |
| `taskpilot-explorer`    | `haiku`  | `leader`: dò code, chỉ đọc                       |
| `taskpilot-implementer` | `sonnet` | `leader`, `member`: sửa code theo việc được giao |
| `taskpilot-reviewer`    | `opus`   | `leader`: rà soát, chỉ đọc                       |
| `taskpilot-tester`      | `sonnet` | `leader`, `member`: viết và chạy test            |

Bản mẫu chỉ được ghi vào `.claude/agents/` của repo; muốn dùng ở user scope, tự chép. Hộp thoại liệt kê từng mẫu kèm trạng thái: chưa có, đã có và giống mẫu (khoá), hoặc đã có nhưng khác mẫu (mặc định không chọn; chọn để ghi đè). **Xem diff** trước khi ghi. Việc ghi đè tạo bản sao lưu, xem ở **Lịch sử thay đổi**. Nếu file đổi sau lúc xem diff, hoặc tên đã bị file khác trong `.claude/agents/` dùng, server trả 409 và không ghi file nào.

### Kiểm tra tương thích

Trang **Agents** hiện badge và mục **Kiểm tra cho TaskPilot** cho từng subagent:

| Badge             | Nghĩa                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `leader · member` | Dùng được cho cả dò code và việc con                                                                                                                                     |
| `chỉ leader`      | Không có `Write`/`Edit`/`MultiEdit` (tính cả `disallowedTools`; không khai `tools` nghĩa là mọi tool). Hợp lệ cho helper chỉ đọc nhưng không được ghi vào bảng Phân công |
| `không dùng được` | Không có vai trò nào, ví dụ bị subagent project cùng tên che                                                                                                             |
| `lỗi`             | Lỗi frontmatter, thiếu `name`/`description`, hoặc `model` không hợp lệ                                                                                                   |

Cảnh báo khác: subagent khai `AskUserQuestion` (việc con không nên hỏi giữa chừng; câu hỏi ghi vào báo cáo), hai file trùng `name` trong một scope. Khi duyệt bảng Phân công, TaskPilot chặn nếu dòng `claude` chọn subagent không tồn tại hoặc không có vai trò `member`. Trên màn hình task có thông báo khi workflow có bước `dispatch` mà không subagent nào ở hai scope làm được `member`.

### Số liệu từng việc

Với việc con Codex, TaskPilot ghi model thực tế và tổng token vào/ra do App Server báo; chi phí theo việc không có. Hạn mức tài khoản Codex hiện ở nút usage, không gán cho việc con. Với việc con chạy Claude, TaskPilot ghi model thật (từ status line), thời gian và chi phí. Số liệu hiện ở cây việc con, nhật ký và biến `{{subtasks}}`; chạy Copilot không có chi phí, thiếu số liệu ghi `model không rõ` / `chi phí không có`, không ước đoán. Bước rà soát của leader dùng chúng để đánh giá từng subagent/model trong mục **Đánh giá subagent / model** của tổng kết.

Sau bàn giao, số liệu giữ provenance theo attempt/session: `claude-statusline`, `codex-thread` hoặc `legacy`. Token/cost cumulative của cùng session chỉ lấy snapshot mới nhất, không cộng lại theo bước hay notification; tổng một counter chỉ có khi mọi session có counter đó, kèm coverage. Không ghép cost Claude vào token Codex để giả chi phí đích, không suy quota từ token. Xem [kiến trúc metrics và quota](SPEC.md#9-metrics-và-bằng-chứng-quota).

Khi bàn giao, `permission-mode` giữ nguyên. Nếu subagent nguồn giới hạn tools/quyền không có cấu hình tương đương ở CLI đích, preflight chặn thay vì bỏ hạn chế; Codex chỉ nhận subagent là file `.codex/agents/*.toml` hợp lệ và không nhận `plan`. Người dùng phải chọn cấu hình tương thích, không có lựa chọn tự tăng quyền để vượt kiểm tra.

`permission-mode` áp dụng cho các phiên workflow:

| Giá trị                 | Claude                          | Copilot                                                        |
| ----------------------- | ------------------------------- | -------------------------------------------------------------- |
| `default` hoặc bỏ trống | Theo mặc định CLI               | Hỏi quyền trước thao tác cần duyệt                             |
| `acceptEdits`           | `--permission-mode acceptEdits` | `--allow-tool=write`                                           |
| `plan`                  | `--permission-mode plan`        | `--mode plan`                                                  |
| `auto`                  | `--permission-mode auto`        | `COPILOT_ALLOW_ALL=true`, cho phép mọi tool và tin cậy thư mục |

`auto` dành cho trường hợp muốn CLI tự xử lý quyền; workflow tích hợp không bật sẵn. Copilot vẫn chạy được với chế độ hỏi quyền và hooks không yêu cầu `auto`. TaskPilot cài hooks ở `~/.copilot/hooks/taskpilot.json`; chúng chỉ xử lý các phiên do TaskPilot khởi tạo.

## Chọn và tùy chỉnh workflow

Mỗi chế độ có một thư mục [`workflows/<id>/`](../workflows) chứa `workflow.yml`, prompt và mẫu tài liệu:

- `default`: điều tra, lập kế hoạch, triển khai; có hai lần duyệt.
- `leader`: lập kế hoạch, giao việc con, rà soát; duyệt kế hoạch và tổng kết.

Chọn trên từng task bằng **Cách chạy**, hoặc dùng **Dùng làm mặc định của repo** trên trang **Workflow**. Lựa chọn của repo được lưu trong `.taskpilot/settings.yml` với `mode: <id>`.

Để thay đổi, dùng **Tạo override dựa trên <mode>**. TaskPilot chỉ ghi vào `.taskpilot/` của repo, không sửa thư mục workflow tích hợp. Override dùng `extends` và chỉ ghi phần khác biệt:

```yaml
extends: default
permission-mode: acceptEdits
steps:
  - id: investigate
    model: sonnet
  - id: implement
    agent: claude
    model: sonnet
```

Quy tắc ghép:

- Các khóa chung `agent`, `model`, `permission-mode`, `language`, `rules`, `history`, `restart` thay thế giá trị gốc khi được khai báo.
- Bước có `id` đã tồn tại chỉ thay các trường được ghi; `outputs` ghép theo `id` đầu ra. Bước mới phải có đúng một trong `before` / `after` để xác định vị trí.
- File prompt hoặc mẫu tài liệu cùng tên thay toàn bộ file gốc. Phần không ghi đè tiếp tục nhận cập nhật từ workflow tích hợp.
- Bước `dispatch` chỉ cho sửa `title` và `dispatch.prompt`, `dispatch.format`, `dispatch.parallel`; không thêm bước ngay sát nó.

Override chỉ áp dụng cho chế độ mà nó `extends`. Commit `.taskpilot/` để chia sẻ cấu hình. Lần chạy giữ nguyên bản chụp workflow lúc bắt đầu; thay đổi chỉ áp dụng cho lần chạy mới hoặc **Chạy lại từ đầu**.

Trang **Workflow** hỗ trợ kiểm tra, xem trước prompt, so sánh với mặc định và khôi phục từng file. **Xoá override** sao lưu trước khi xóa và giữ lựa chọn chế độ trong `settings.yml`. Override cũ không có `extends` vẫn chạy dưới chế độ `custom`; có thể chuyển đổi qua giao diện, nhưng chú thích YAML chỉ được giữ trong bản sao lưu. `.claude/workflow.yml` không còn được đọc.

## Khai báo bước và prompt

Định dạng workflow đầy đủ dùng `version: 2`; tham khảo [workflow mặc định](../workflows/default/workflow.yml) và [workflow leader](../workflows/leader/workflow.yml).

| Trường của bước thường | Ý nghĩa                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `id`, `title`          | Mã và tên bước                                                      |
| `agent`, `model`       | Ghi đè CLI và model chung                                           |
| `prompt`               | File prompt nằm cạnh `workflow.yml`                                 |
| `on-reject`            | Prompt khi nhận góp ý; bỏ trống thì gửi nguyên góp ý                |
| `outputs`              | Danh sách tài liệu với `id`, `file`, `content` và `format` tùy chọn |
| `done-when`            | `id` đầu ra cần được ghi trong bước hiện tại                        |
| `gate`                 | `approve` để chờ duyệt, hoặc `none` để đi tiếp                      |

`format` trỏ đến file mẫu có các heading cần giữ. Đổi tên file đầu ra có thể thay cách danh sách task nhận diện tiến độ của tài liệu cũ.

Biến dùng trong prompt và mẫu tài liệu:

| Biến                                                       | Nội dung                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `{{key}}`, `{{title}}`                                     | Mã và tiêu đề task                                                                                      |
| `{{step}}`, `{{stepNumber}}`, `{{stepCount}}`, `{{agent}}` | Bước hiện tại và agent thực hiện                                                                        |
| `{{taskDir}}`, `{{specDir}}`                               | Thư mục task và yêu cầu                                                                                 |
| `{{historyFile}}`, `{{historyEntry}}`, `{{historyFormat}}` | Nhật ký, heading và mẫu entry                                                                           |
| `{{outputs}}`, `{{inputs}}`, `{{out.<id>}}`                | Đầu ra hiện tại, đầu ra các bước trước và đường dẫn một đầu ra                                          |
| `{{rules}}`, `{{language}}`                                | Quy tắc chung và ngôn ngữ tài liệu                                                                      |
| `{{previousRun}}`, `{{archiveDir}}`                        | Bối cảnh và thư mục lần chạy trước; rỗng nếu không chạy lại                                             |
| `{{feedback}}`                                             | Góp ý, chỉ dùng trong prompt `on-reject`                                                                |
| `{{subagents}}`                                            | Danh sách subagent có thể dùng để leader lập bảng phân công                                             |
| `{{subtask}}`, `{{subtaskReport}}`                         | Nội dung việc con và đường dẫn báo cáo trong prompt giao việc                                           |
| `{{subtasks}}`                                             | Danh sách việc con, báo cáo và số liệu phiên nếu có cho bước sau giao việc                              |
| `{{executionPolicy}}`                                      | Chính sách hiệu lực và bối cảnh bàn giao; renderer ghép ở đầu prompt để các template cũ vẫn nhận policy |
| `{{leaderTools}}`                                          | Hướng dẫn công cụ leader theo CLI hiệu lực; không buộc Codex/Copilot gọi Claude Task tool               |

Chính sách execution và bối cảnh bàn giao được server ghép vào prompt qua resolver/builder; không cần thêm khóa execution vào workflow YAML hoặc tự khai biến prompt mới. Preview YAML thuần theo cấu hình workflow; preview run nhận lựa chọn execution và ghi rõ cấu hình yêu cầu cùng phần chưa kiểm chứng.

TaskPilot chặn lưu khi workflow sai: thiếu file prompt, `done-when` không hợp lệ, tham chiếu đầu ra không tồn tại hoặc dùng `feedback` sai chỗ. Biến chưa biết, prompt không dùng và prompt đầu thiếu `previousRun` là cảnh báo. `bypassPermissions` không được chấp nhận trong workflow.

## Leader và việc con

Kế hoạch cần mục **Phân công** chứa bảng, ví dụ:

| #   | Việc                | Agent  | Subagent | Model  | File                       | Đầu ra                | Phụ thuộc |
| --- | ------------------- | ------ | -------- | ------ | -------------------------- | --------------------- | --------- |
| 1   | Sửa trạng thái rỗng | claude | -        | sonnet | client/src/features/tasks/ | Giao diện và kiểm tra | -         |
| 2   | Cập nhật hướng dẫn  | claude | -        | sonnet | docs/GUIDE.md              | Hướng dẫn mới         | 1         |

`Subagent` và `Model` là tùy chọn (`-`, `—` hoặc ô trống nghĩa là dùng mặc định); bảng 6 cột cũ vẫn chạy. `Subagent` chọn cấu hình agent cho cả phiên bằng `--agent`, khác với cột `Agent` chọn CLI; `Model` ưu tiên hơn model của subagent. Quy tắc ở [Subagent và model](#subagent-và-model).

`File` liệt kê file/thư mục được sửa, phân cách bằng dấu phẩy; `Phụ thuộc` liệt kê số việc cần hoàn tất trước. Bảng sai agent, số việc, phụ thuộc hoặc có vòng lặp sẽ chặn duyệt.

Mỗi việc ghi báo cáo `03-viec-<n>.md`. Để chạy tối đa hai việc cùng lúc:

```yaml
extends: leader
steps:
  - id: dispatch
    dispatch:
      parallel: 2
```

`parallel` nhận từ 1 đến 4. Khi chạy song song, mỗi việc phải khai báo `File`; chỉ các việc đã đủ phụ thuộc và không trùng phạm vi file với việc đang chạy mới được khởi động. Đây là điều phối theo đường dẫn khai báo, không phải cơ chế cô lập filesystem.

Workflow đầy đủ chỉ cho phép một `dispatch`, ngay sau bước `gate: approve` và có bước tiếp theo. `dispatch.from` trỏ tới đầu ra kế hoạch; `report` phải chứa `{{n}}`. Bước này không khai báo `prompt`, `outputs`, `done-when` hoặc `gate` ở cấp bước.
