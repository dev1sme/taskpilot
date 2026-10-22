# Cấu hình TaskPilot

## Biến môi trường

TaskPilot đọc `.env` cạnh `package.json` của chính ứng dụng, kể cả khi khởi chạy từ repo khác. Thứ tự ưu tiên: tùy chọn CLI → môi trường tiến trình → `.env` → mặc định. Xem mẫu tại [`.env.example`](../.env.example).

| Biến | Mặc định / ý nghĩa |
|---|---|
| `TASKPILOT_HOST` / `TASKPILOT_PORT` | `127.0.0.1` / `8790`; có thể ghi đè bằng `--host` / `--port` |
| `TASKPILOT_HOME` | `~/.taskpilot`; nơi lưu trạng thái, bản sao lưu và dữ liệu xác thực |
| `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` | Tài khoản đăng nhập; đặt cả hai hoặc để trống cả hai |
| `TASKPILOT_TOKEN` | Token cố định thay cho token ngẫu nhiên; khi dùng tài khoản, đây là token API tùy chọn cho header `x-taskpilot-token` |
| `TASKPILOT_ALLOWED_HOSTS` | Danh sách hostname bổ sung được chấp nhận, phân cách bằng dấu phẩy |
| `TASKPILOT_CLAUDE` / `TASKPILOT_COPILOT` | Lệnh CLI; mặc định `claude` / `copilot` |
| `TASKPILOT_CLAUDE_HOME` / `TASKPILOT_CLAUDE_JSON` | Nơi TaskPilot đọc cấu hình Claude; mặc định `~/.claude` / `~/.claude.json` |
| `COPILOT_HOME` | Thư mục cấu hình Copilot, gồm hooks; mặc định `~/.copilot` |

Đăng nhập, reverse proxy và giới hạn truy cập được mô tả tại [Triển khai](DEPLOY.md).

## Cấu hình Claude và MCP

Các trang cấu hình cho phép chỉnh `CLAUDE.md`, settings, quyền, hooks, agents, commands, skills và MCP theo phạm vi project, local hoặc user. Mỗi lần lưu đều có bản so sánh trước khi ghi, kiểm tra xung đột và sao lưu để khôi phục từ **Lịch sử thay đổi**. Nếu file đã đổi bên ngoài, tải lại trước khi sửa tiếp.

**Thư viện** chia agents, commands và skills theo thư mục. Các mục trùng tên bị che bởi phạm vi ưu tiên cao hơn sẽ được đánh dấu:

| Loại | Thứ tự ưu tiên từ cao xuống thấp |
|---|---|
| MCP | Local → project → user |
| Agents | Project → user |
| Skills, commands | User → project |

MCP project nằm trong `.mcp.json`; local và user nằm trong `~/.claude.json` và được sửa thông qua `claude mcp`. Với MCP dùng chung, đánh dấu giá trị là bí mật để lưu `${VAR}` trong file, còn giá trị thật nằm trong kho môi trường của TaskPilot. Các phiên do TaskPilot mở nhận biến này; phiên CLI tự mở cần biến tương ứng trong shell. Giá trị bí mật được che trước khi trả về trình duyệt.

TaskPilot cung cấp các mẫu subagent tại [`subagents/claude/`](../subagents/claude). Chép mẫu cần dùng vào `.claude/agents/` của repo để CLI nhận diện. Subagent làm việc con cần quyền ghi báo cáo.

## Agent và model

`agent` chọn CLI: `claude` hoặc `copilot`. `model` chọn model của phiên; giá trị ở từng bước ghi đè giá trị chung. Khi bước sau đổi agent hoặc model, TaskPilot tạo phiên mới và chuyển bối cảnh qua tài liệu cùng nhật ký.

Workflow `default` dùng Claude điều tra và Copilot triển khai. Để chỉ dùng Claude, tạo `.taskpilot/workflow.yml` trong repo cần xử lý:

```yaml
extends: default
steps:
  - id: implement
    agent: claude
```

Thêm `model: sonnet` vào một bước để chọn model Claude cho bước đó. Bỏ `model`, hoặc dùng `default` / `inherit`, để CLI dùng model mặc định. Model Copilot phụ thuộc tài khoản; không mặc định coi alias của Claude là model Copilot hợp lệ. Nếu đặt model chung rồi đổi CLI ở một bước, nên đặt model riêng cho bước ấy.

`permission-mode` áp dụng cho các phiên workflow:

| Giá trị | Claude | Copilot |
|---|---|---|
| `default` hoặc bỏ trống | Theo mặc định CLI | Hỏi quyền trước thao tác cần duyệt |
| `acceptEdits` | `--permission-mode acceptEdits` | `--allow-tool=write` |
| `plan` | `--permission-mode plan` | `--mode plan` |
| `auto` | `--permission-mode auto` | `COPILOT_ALLOW_ALL=true`, cho phép mọi tool và tin cậy thư mục |

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

| Trường của bước thường | Ý nghĩa |
|---|---|
| `id`, `title` | Mã và tên bước |
| `agent`, `model` | Ghi đè CLI và model chung |
| `prompt` | File prompt nằm cạnh `workflow.yml` |
| `on-reject` | Prompt khi nhận góp ý; bỏ trống thì gửi nguyên góp ý |
| `outputs` | Danh sách tài liệu với `id`, `file`, `content` và `format` tùy chọn |
| `done-when` | `id` đầu ra cần được ghi trong bước hiện tại |
| `gate` | `approve` để chờ duyệt, hoặc `none` để đi tiếp |

`format` trỏ đến file mẫu có các heading cần giữ. Đổi tên file đầu ra có thể thay cách danh sách task nhận diện tiến độ của tài liệu cũ.

Biến dùng trong prompt và mẫu tài liệu:

| Biến | Nội dung |
|---|---|
| `{{key}}`, `{{title}}` | Mã và tiêu đề task |
| `{{step}}`, `{{stepNumber}}`, `{{stepCount}}`, `{{agent}}` | Bước hiện tại và agent thực hiện |
| `{{taskDir}}`, `{{specDir}}` | Thư mục task và yêu cầu |
| `{{historyFile}}`, `{{historyEntry}}`, `{{historyFormat}}` | Nhật ký, heading và mẫu entry |
| `{{outputs}}`, `{{inputs}}`, `{{out.<id>}}` | Đầu ra hiện tại, đầu ra các bước trước và đường dẫn một đầu ra |
| `{{rules}}`, `{{language}}` | Quy tắc chung và ngôn ngữ tài liệu |
| `{{previousRun}}`, `{{archiveDir}}` | Bối cảnh và thư mục lần chạy trước; rỗng nếu không chạy lại |
| `{{feedback}}` | Góp ý, chỉ dùng trong prompt `on-reject` |
| `{{subagents}}` | Danh sách subagent có thể dùng để leader lập bảng phân công |
| `{{subtask}}`, `{{subtaskReport}}` | Nội dung việc con và đường dẫn báo cáo trong prompt giao việc |
| `{{subtasks}}` | Danh sách việc con, báo cáo và số liệu phiên nếu có cho bước sau giao việc |

TaskPilot chặn lưu khi workflow sai: thiếu file prompt, `done-when` không hợp lệ, tham chiếu đầu ra không tồn tại hoặc dùng `feedback` sai chỗ. Biến chưa biết, prompt không dùng và prompt đầu thiếu `previousRun` là cảnh báo. `bypassPermissions` không được chấp nhận trong workflow.

## Leader và việc con

Kế hoạch cần mục **Phân công** chứa bảng, ví dụ:

| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |
|---|---|---|---|---|---|---|---|
| 1 | Sửa trạng thái rỗng | claude | - | sonnet | client/src/features/tasks/ | Giao diện và kiểm tra | - |
| 2 | Cập nhật hướng dẫn | claude | - | sonnet | docs/GUIDE.md | Hướng dẫn mới | 1 |

`Subagent` và `Model` là tùy chọn; `-` nghĩa là dùng mặc định. `Subagent` chọn cấu hình agent cho cả phiên bằng `--agent`, khác với cột `Agent` chọn CLI. Model khai báo trực tiếp ưu tiên hơn model của subagent. Subagent phải tồn tại và có quyền ghi báo cáo.

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
