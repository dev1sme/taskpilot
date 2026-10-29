# TaskPilot

Chạy quy trình lập kế hoạch và triển khai bằng Claude Code, GitHub Copilot CLI hoặc Codex CLI ngay trong repo, với các bước chờ bạn duyệt.

TaskPilot đọc yêu cầu từ `.claude/tasks/<key>/spec/`, gửi prompt vào phiên CLI tương tác và hiển thị tài liệu, tiến độ, terminal trong trình duyệt. Bạn có thể nhập trực tiếp vào terminal; cấu hình và quyền của CLI vẫn được áp dụng.

```mermaid
flowchart LR
    spec["Yêu cầu"] --> plan["Điều tra & lập kế hoạch"]
    plan --> reviewPlan{"Bạn duyệt kế hoạch"}
    reviewPlan -->|Duyệt| implement["Triển khai"]
    reviewPlan -->|Góp ý| plan
    implement --> reviewResult{"Bạn duyệt kết quả"}
    reviewResult -->|Duyệt| done["Hoàn thành"]
    reviewResult -->|Góp ý| implement
```

## Tính năng

- **Workflow theo cách chạy.** `Solo`: một agent điều tra, lập kế hoạch rồi triển khai; ba duyệt sau mỗi bước. `Leader`: leader lập kế hoạch và giao việc, mỗi việc con chạy trong session riêng, rồi leader rà soát. Repo đổi workflow bằng override trong `.taskpilot/` (trang Workflow).
- **Chọn agent và model** cho mỗi lần chạy, hoặc lưu làm mặc định repo. Khi đang làm dở, **Tiếp tục bằng…** bàn giao đúng bước hoặc việc con sang session mới, giữ tài liệu và lịch sử.
- **Cấu hình agent** (Claude, Copilot, Codex): mỗi mục có hai cách xem. **Giao diện** chỉ để xem; **Raw** sửa thẳng file của CLI, xem diff trước khi lưu, kiểm cú pháp và sao lưu file cũ (trang Lịch sử thay đổi để khôi phục).
- **Tổng quan**: việc đang chờ bạn, run đang chạy, hạn mức tài khoản của từng agent.

## Yêu cầu

- Node.js 22+; đã thử trên Node.js 24.
- Bộ công cụ biên dịch cho `node-pty`: `g++`, `make`, `python3`.
- CLI của agent được chọn đã cài và đăng nhập; Claude/Copilot dùng `curl` để gửi hooks.
- Codex CLI (`codex`) đã đăng nhập qua `codex login` nếu dùng agent Codex.

## Cài và chạy

Trong thư mục mã nguồn TaskPilot:

```bash
npm ci
npm run build
npm start -- --repo /duong/dan/repo --open
```

Mở URL server in ra, có dạng `http://127.0.0.1:8790/?token=…`. Nếu đã cấu hình tài khoản, trình duyệt hiện màn hình đăng nhập.

Để dùng lệnh `taskpilot` ở mọi thư mục, chạy `npm link` trong thư mục TaskPilot, rồi:

```bash
taskpilot --repo /duong/dan/repo --open
```

| Tùy chọn        | Ý nghĩa                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `--repo <path>` | Repo cần mở; mặc định dùng thư mục hiện tại nếu có `.claude/tasks`, nếu không thì dùng repo mở gần nhất |
| `--host <addr>` | Địa chỉ lắng nghe; mặc định `127.0.0.1`                                                                 |
| `--port <n>`    | Cổng; mặc định `8790`                                                                                   |
| `--open`        | Mở trình duyệt                                                                                          |

Biến môi trường (địa chỉ, cổng, đăng nhập, token) đọc từ `.env` cạnh `package.json`; xem `.env.example`.

## Chạy như service

TaskPilot chạy được như systemd user service, dùng `node` và `claude` (và `copilot` nếu có) trên `PATH` hiện tại:

```bash
cp .env.example .env   # rồi điền, chmod 600
make service-install   # build, ghi ~/.config/systemd/user/taskpilot.service, bật và khởi động lại
make service-restart   # sau khi pull code mới; các session dừng, tiếp tục từ giao diện
make service-logs
```

## Phát triển

Monorepo npm workspaces:

| Thư mục           | Package             | Nội dung                                                                   |
| ----------------- | ------------------- | -------------------------------------------------------------------------- |
| `apps/server`     | `@taskpilot/server` | Fastify server, workflow engine, session CLI; `workflows/` và `subagents/` |
| `apps/web`        | `@taskpilot/web`    | React (Vite, TanStack Router/Query, Tailwind); xem `DESIGN.md`             |
| `packages/shared` | `@taskpilot/shared` | Mã thuần dùng chung (provider id, nhãn)                                    |
| `e2e`             | (riêng)             | Playwright, chạy app cô lập                                                |

Web chỉ import type của API từ `@taskpilot/server/api-types`; mỗi module server giữ type API trong `types.ts` của nó.

```bash
make dev             # server :8791 (tsx watch) + Vite
npm run typecheck    # build shared, typecheck server (kèm emit type API) và web
npm run lint
npm run format
npm run e2e
```

Sửa `packages/shared` thì chạy `npm run build -w @taskpilot/shared`, vì server và web đọc `dist/` của nó.
