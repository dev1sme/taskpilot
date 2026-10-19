# Claude Task Board

Bảng điều khiển trên trình duyệt để giao task từ **Nulab Backlog** cho **Claude Code**,
theo dõi tiến trình theo thời gian thực và duyệt kế hoạch trước khi Claude sửa code.
Thay cho việc gõ prompt lặp đi lặp lại trong terminal.

```
Backlog ──Bắt đầu──▶ Điều tra ──▶ Chờ duyệt plan ──Duyệt──▶ Đang code ──▶ Xong
                         ▲              │
                         └─ Sửa plan ◀──┘ (góp ý)
```

Mỗi task có tài liệu riêng trong repo:

```
<repo>/.claude/tasks/<mã task>/
  00-task.md            nội dung task lấy từ Backlog
  01-investigation.md   kết quả điều tra codebase
  02-plan.md            kế hoạch (bạn duyệt file này)
  03-progress.md        tiến độ khi code
  04-summary.md         tóm tắt kết quả, đăng lên Backlog khi xong
```

## Cần có

- Java 17 trở lên
- Claude Code đã cài và đăng nhập (chạy được lệnh `claude` trong terminal)
- API key của Backlog: vào Backlog → ảnh đại diện → Cài đặt cá nhân → API

## Chạy thử ngay (không cần cấu hình)

1. Đặt `claude-task-board.jar`, `application.yml`, `run.bat` (hoặc `run.sh`) chung một thư mục.
2. Trong `application.yml`, đặt `board.repo.path` là repo muốn thử, và `board.claude.simulate: true`.
3. Chạy `run.bat` (Windows) hoặc `./run.sh`. Trình duyệt tự mở `http://127.0.0.1:8787`.

Khi chưa có `base-url`/`api-key` của Backlog, tool hiện 4 task mẫu. Với `simulate: true`,
tool giả lập Claude nên không tốn token. Đủ để thử toàn bộ giao diện.

## Cấu hình thật

Sửa `application.yml`:

```yaml
board:
  repo:
    path: "D:/projects/my-app"
    folder-pattern: "{issueKey}"          # hoặc "{issueKey}-{slug}"
  backlog:
    base-url: "https://tencongty.backlog.com"   # hoặc .backlog.jp
    api-key: "xxxxxxxx"
    project-key: "PROJ"
    status-on-start: "処理中"             # đúng tên trạng thái trong project, để trống = không đổi
    status-on-done: "処理済み"
  claude:
    simulate: false
    model: "sonnet"                       # để trống = mặc định của Claude Code
```

Không muốn để API key trong file? Có thể đặt file cấu hình ở chỗ khác và chạy
`java -jar claude-task-board.jar --config=C:/secure/application.yml`.

## Cách dùng hằng ngày

1. Cột **Backlog** liệt kê task đang mở được giao cho bạn. Bấm **Bắt đầu**.
2. Claude điều tra và viết kế hoạch. Bước này Claude **chỉ đọc code**, không được chạy lệnh shell,
   chỉ được ghi vào thư mục tài liệu của task.
3. Task chuyển sang cột **Chờ duyệt plan** (nền vàng, góc trên hiện số việc đang chờ bạn).
   Mở task, đọc `02-plan.md` ở tab **Tài liệu**, rồi:
   - **Duyệt và bắt đầu code**: Claude code tiếp trong cùng phiên, nên nhớ toàn bộ quá trình điều tra.
   - **Yêu cầu sửa kế hoạch**: ghi góp ý, Claude sửa plan rồi quay lại chờ duyệt.
4. Khi code, Claude tạo nhánh `feature/<mã task>`, được commit nhưng **không push, không merge**.
5. Xong thì `04-summary.md` được đăng thành comment trên Backlog và trạng thái task được đổi (nếu cấu hình).

Tab **Tiến trình** hiện từng bước Claude làm (đọc file nào, chạy lệnh gì) theo thời gian thực.
Ô **Gửi tin nhắn** cho phép nhắn thêm cho Claude trong cùng phiên, ví dụ khi review thấy cần sửa.

## Quyền của Claude

| Bước | Chế độ | Được làm |
|---|---|---|
| Điều tra | Manual (`default`) | Đọc code, ghi vào thư mục tài liệu của task. Không chạy shell. |
| Code | `acceptEdits` | Sửa file trong repo, chạy các lệnh trong `implement-allowed-tools` (mvn, gradle, git…) |

Lệnh nằm ngoài danh sách sẽ bị từ chối, Claude được dặn không tìm cách lách.
Giao diện liệt kê các lệnh bị từ chối kèm gợi ý quy tắc như `Bash(npm test *)`;
tích chọn rồi bấm **Chạy lại** hoặc **Gửi tin nhắn** để cấp quyền cho riêng task đó.
Muốn cấp cho mọi task thì thêm vào `implement-allowed-tools` trong `application.yml`.

**Vì sao tài liệu được ghi qua một thư mục trung gian?** Claude Code chạy nền không được phép ghi
vào thư mục `.claude/` của repo (thư mục được bảo vệ). Vì vậy Claude ghi vào
`~/.claude-task-board/work/<mã task>/`, còn tool tự sao chép sang `.claude/tasks/<mã task>/`
ngay sau mỗi lần ghi. Bạn không cần làm gì thêm.

## Chạy song song

- `investigate-slots: 3`: tối đa 3 task điều tra cùng lúc (chỉ đọc nên an toàn).
- `implement-slots: 1`: mỗi lần chỉ một task được code, vì các task cùng sửa một repo.
  Task khác hiện trạng thái **Chờ lượt** và tự chạy khi tới lượt.

## Sửa prompt

Prompt nằm trong `src/main/resources/prompts/`. Muốn đổi mà không build lại:
copy thư mục `prompts/` ra ngoài, sửa, rồi đặt `board.prompts-dir: "đường/dẫn/prompts"`.
Biến có thể dùng: `{{issueKey}}`, `{{summary}}`, `{{workDir}}`, `{{repoDocsDir}}`, `{{language}}`,
`{{feedback}}` (revise), `{{note}}` (implement), `{{message}}` (followup), `{{phase}}` (retry).

## Dữ liệu của tool

Tất cả nằm trong `~/.claude-task-board/` (đổi bằng `board.data-dir`):
`tasks.json` (trạng thái task), `logs/` (nhật ký từng task), `work/` (thư mục làm việc của Claude).

Tắt tool khi Claude đang chạy thì task chuyển sang **Đã dừng**; mở lại và bấm **Chạy lại**
để Claude tiếp tục đúng phiên cũ.

## Build từ mã nguồn

```bash
mvn package
# -> target/claude-task-board.jar (đã gồm thư viện)
```

Mã nguồn chia theo gói:

- `backlog/` gọi Backlog API v2
- `agent/` chạy `claude -p --output-format stream-json` và đọc sự kiện; `SimulatedAgentRunner` để giả lập
- `task/` vòng đời task, lưu trữ, tài liệu .md, prompt
- `web/` HTTP API, realtime (Server-Sent Events) và giao diện trong `resources/static/`

## Gặp lỗi

- **Không chạy được lệnh 'claude'**: đặt `board.claude.command` là đường dẫn đầy đủ,
  ví dụ `C:/Users/ten/.local/bin/claude.exe`. Chạy `where claude` (Windows) hoặc `which claude` để tìm.
- **Backlog API trả lỗi 401**: kiểm tra `api-key` và `base-url` (`.backlog.com` hay `.backlog.jp`).
- **Không đổi được trạng thái**: `status-on-start` / `status-on-done` phải trùng chính xác tên trạng thái trong project.
- **Chữ tiếng Việt lỗi trong cửa sổ console**: dùng `run.bat` (đã chuyển console sang UTF-8). Giao diện web không bị ảnh hưởng.
