# Phát triển TaskPilot

## Chạy môi trường dev

Cài [các yêu cầu](../README.md#yêu-cầu), chạy `npm ci` tại gốc repo, rồi mở hai terminal:

```bash
npm run dev:server   # API: 127.0.0.1:8791, token dev
npm run dev:client   # Giao diện: http://127.0.0.1:5173/?token=dev
```

Có thể chạy cả hai bằng `make dev`. Nếu `.env` đặt tài khoản đăng nhập, dùng tài khoản đó thay cho token `dev`. Cổng dev tách khỏi cổng service `8790`.

## Kiểm tra

Chạy các kiểm tra phù hợp trước khi gửi thay đổi:

```bash
npm test                 # Unit test, quy tắc kiến trúc và chuỗi giao diện
npm run typecheck        # TypeScript server và client
npm run i18n:lint        # Chuỗi JSX cần đưa vào tài nguyên dịch
npm run lint             # Quy tắc React hooks (ESLint)
npm run format:check     # Định dạng Prettier
npm run build            # Build giao diện và server
```

Chạy `npm run format` để sửa định dạng.

E2E dùng Playwright, cần cài bộ phụ thuộc riêng và Chromium. Chạy từ gốc repo:

```bash
npm --prefix e2e ci
(cd e2e && npx playwright install chromium)
npm run e2e -- -- --workers=1
npm --prefix e2e run typecheck
```

Các test Codex dùng `e2e/fake-codex.mjs`, nạp [`server/test/helpers/fake-codex.mjs`](../server/test/helpers/fake-codex.mjs): có `app-server` trong argv thì là app-server cho probe/hạn mức, không có thì nạp [`fake-codex-tui.mjs`](../server/test/helpers/fake-codex-tui.mjs), TUI giả dựng theo fixture `server/test/fixtures/codex-tui/` của 0.163.0. TUI giả đọc đúng argv của `codexLauncher`, in footer sẵn sàng, nhận bracketed paste và chạy thật lệnh hook từ `-c hooks.*` (nên guard `TASKPILOT_HOOK_AGENT` cũng được kiểm). Trigger trong prompt: `WRITE:<file>` (`PLAN_TABLE` ra bảng Phân công), `APPROVAL` (hộp thoại; `y`/Enter chấp nhận, Esc từ chối), `SLOW` (giữ tool tới khi Esc, bắn `Interrupt`), `RECALL` (trả lại prompt trước của thread). `codex resume <id>` đọc `.fake-codex-threads/<id>.json` trong cwd. Vitest dùng [`server/test/helpers/codex-tui.ts`](../server/test/helpers/codex-tui.ts) (`codexTuiLauncher`, `startHookServer`, `seedCodexThread`). Project `codex` chạy sau `chromium` vì dùng repo có workflow riêng. Chạy riêng sau khi có phiên đăng nhập E2E: `npm --prefix e2e test -- --project=codex --no-deps`.

Bộ E2E tự mở server và client trên cổng `8891` / `5273`, dùng dữ liệu tạm trong `e2e/.tmp/`. Claude, Copilot và Codex được thay bằng script giả; bài kiểm thử không xác nhận khả năng tương thích với CLI thật. Cấu hình mặc định `workers: 1` vì server có một current repo: đổi repo trong các bài selection/handoff có thể xung đột nếu dùng nhiều worker. `npm run e2e` chạy tuần tự cả suite; hai dấu `--` ở lệnh gốc truyền cờ qua hai lớp npm khi cần thêm cờ. Không chạy hai suite E2E đồng thời trên cùng cổng/state. Sau khi chạy, xem báo cáo bằng `npm --prefix e2e run report`.

### Regression cấu hình ba CLI

Fixture `e2e/fixtures/repo.ts` tạo file hướng dẫn, settings, agent và MCP riêng của Claude, Copilot, Codex trong repo tạm. Home Claude/Copilot của server E2E cũng nằm trong `e2e/.tmp/`; các ca Codex hiện kiểm file project. Chạy nhóm E2E mục tiêu:

```bash
npm test -- server/test/modules/config
npm --prefix e2e test -- tests/config-tabs.spec.ts tests/config-state.spec.ts tests/mcp.spec.ts tests/subagents.spec.ts --project=chromium --workers=1
```

Các ca ba CLI kiểm API native và URL selector. Route giao diện hiện chỉ mở biểu mẫu Claude; khi tích hợp `ConfigPage.tsx`, bổ sung ca UI sửa file, đổi CLI khi có draft và backup/restore cho Copilot/Codex. Không ghi kết quả API là bằng chứng biểu mẫu web đã hoạt động.

### Regression execution và bàn giao

Chạy từ gốc repo:

```bash
npm test -- server/test/modules/workflow server/test/modules/sessions server/test/modules/config/workflow.test.ts server/test/modules/config/preserved-fields.test.ts server/test/core/safe-text.test.ts server/test/modules/usage/store.test.ts server/test/architecture.test.ts server/test/i18n.test.ts
npm --prefix e2e test -- tests/run-selection.spec.ts tests/handoff.spec.ts tests/run-mode.spec.ts tests/run-restart.spec.ts tests/subtasks.spec.ts tests/task-state.spec.ts tests/questions.spec.ts --project=chromium --workers=1
npm --prefix e2e test -- tests/codex.spec.ts --project=codex --no-deps --workers=1
```

Selection kiểm launch thật qua fake CLI khớp preview cho default/Leader/custom, policy, repo defaults và recovery. Handoff kiểm main/member, source đang chạy/chờ quyền/đã thoát/no-hook, target mới, stale/request kép, reservation, output baseline và metrics. Unit fault matrix dựng restart tại các mốc journal và lỗi persist/start/stop/paste; không tự nhận tương đương SIGKILL production. Fake Copilot không được thay bằng CLI thật trong E2E.

Codex TUI không có lỗi quota có kiểu (`quotaDetection: unknown`), nên fake Codex không giả lập lỗi quota; giao diện quota được kiểm bằng dữ liệu state giả trong `handoff.spec.ts`. Fake chứng minh đường launcher/hook/UI/guard, không chứng minh hành vi Codex thật hay quota thật. Nguồn fixture: [phiên TUI](../server/test/fixtures/codex-tui/README.md), [app-server cho probe/hạn mức](../server/test/fixtures/codex/README.md). Nếu localhost/tsx/child process bị sandbox chặn (`EPERM`), chạy lại với quyền phù hợp và ghi riêng kết quả môi trường; không làm yếu test để né lỗi. Assertion cũ còn fail phải báo rõ, targeted PASS không thay cho full suite PASS.

### Smoke Codex thật có giới hạn

Chỉ chạy sau build và kiểm tự động, trong repo/state tạm riêng. Ghi thời điểm, TaskPilot version/HEAD và dirty state, Node, `codex --version`, `claude --version`, `copilot --version` nếu có; ghi model **yêu cầu** và **thực tế** riêng. Dùng đăng nhập Codex có sẵn, không chép auth vào báo cáo, không cài CLI, tự đăng nhập, bật credits hay cố làm nguồn hết quota.

1. Tạo repo tạm dưới `/tmp`, spec tiếng Việt chỉ yêu cầu một file nhỏ, tối đa 1–2 việc con. Tạo `TASKPILOT_HOME` riêng; không đổi `HOME`/`CODEX_HOME`, không chạy trong checkout đang được TaskPilot điều khiển. Chọn cổng riêng, chẳng hạn `8894`, và build client có sẵn. Không tạo `.taskpilot/workflow.yml` cho ca Leader đầu tiên.
2. Mở server thử nghiệm: `TASKPILOT_HOME=<state-tạm> TASKPILOT_TOKEN=<token-thử> node dist/server/index.js --repo <repo-tạm> --port 8894`. Nếu `.env` có auth, dùng tài khoản phù hợp hoặc harness `buildApp` với auth thử riêng; không ghi token/password thật vào artifact. Đảm bảo mọi session chạy đúng repo tạm. Giữ quyền mặc định; nếu Codex yêu cầu quyền, xem nội dung trong terminal của phiên và chỉ duyệt thao tác thuộc phạm vi smoke. Không tăng quyền để tránh approval. Phiên Codex đầu tiên có thể hiện `Trust this folder?` và `Hooks need review` trong terminal: chọn tin cậy (hook TaskPilot chỉ chạy sau bước này) và ghi lại; Codex lưu lựa chọn vào `~/.codex/config.toml` của tài khoản đang dùng, nên backup file này trước và khôi phục sau smoke nếu không muốn giữ.
3. Qua UI chọn **Leader + Codex + Mặc định của agent**, preview rồi start. Kiểm CLI/model hiệu lực, đầu ra điều tra/kế hoạch, gửi một góp ý ngắn, duyệt kế hoạch, chờ member báo cáo, leader review và duyệt đến done. Ghi session/native thread, model thực tế, token nếu có và tên file đầu ra. Kiểm bảng chỉ có 1–2 việc, agent/model đúng policy.
4. Dựng một lane Claude **đã dừng** từ fixture state/tài liệu trước khi server nạp state (hoặc dùng phiên nguồn thật đã stop). Dùng `loadWorkflow` lấy snapshot hợp lệ; có SessionMeta nguồn và run interrupted với stepIndex/scope rõ ràng, không có process sống/pending approval giả. Giữ prompt nguồn đã render và tài liệu/format liên quan nếu có; fixture không có prompt nguồn phải ghi thiếu bối cảnh. Ghi rõ nguồn là fixture hay Claude thật; thiếu tài khoản nguồn không bỏ ca này. Chỉ chọn **Tiếp tục bằng… → Codex** qua UI, xem preview và commit; không viết journal/đổi lane thủ công để giả bàn giao thành công.
5. Kiểm đích là session/thread mới, giữ bước, spec/tài liệu/file sentinel và phụ thuộc/việc done nếu fixture có; report/output mới qua gate, không archive; source ở lịch sử và resume trả 409. Kiểm riêng bảng Phân công tại gate: có file đầu ra chưa chứng minh bảng hợp lệ để duyệt. Ngoại lệ không đổi bước tương lai. Nếu fixture không có member/dependency, ghi giới hạn đó thay vì nhận đã smoke chúng.
6. Giới hạn mỗi pha LLM 3 phút, toàn smoke khoảng 10 phút và chỉ một lượt sửa feedback; thời gian đợi người duyệt quyền ghi riêng. Nếu startup/account/model/network hoặc lane bị khóa, ghi BLOCKED cùng evidence, không báo PASS. Dừng tiến trình thử sau khi ghi artifact; giữ repo/state, log và screenshot để review, không để nguồn/đích tiếp tục viết nền.

Ghi report với command/kết quả thật, version và đường dẫn artifact; phân biệt tự động, smoke thật và fixture. Không ép tài khoản hết quota, kiểm crash production, chuyển native chat/MCP/hooks giữa CLI hoặc suy phần Claude/Copilot chưa chạy từ kết quả Codex. Tham khảo schema/priority/recovery trong [SPEC](SPEC.md#8-execution-và-bàn-giao).

## Bố cục mã nguồn

| Đường dẫn                                | Vai trò                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `server/src/index.ts`, `app.ts`          | CLI, khởi tạo dịch vụ và đăng ký routes                                                                  |
| `server/src/core/`                       | Hạ tầng dùng chung, trạng thái và i18n; `providers.ts` là nguồn `ProviderId`                             |
| `server/src/providers/<provider>/`            | Phần riêng của `claude`, `codex`, `copilot`: launcher, `home.ts`, `version.ts`, đọc/ghi định dạng native |
| `server/src/modules/sessions/backends/`  | `ProviderBackend` của từng provider (trait + port), ghép provider vào session                                |
| `server/src/modules/<name>/`             | Tính năng server; `index.ts` là điểm truy cập giữa các module                                            |
| `server/test/`                           | Kiểm thử theo cấu trúc server; tiện ích ở `helpers/`                                                     |
| `client/src/app/`                        | Ghép ứng dụng và bố cục                                                                                  |
| `client/src/features/<name>/`            | Thành phần, hooks, API, kiểu dữ liệu và CSS theo tính năng                                               |
| `client/src/shared/`                     | API và UI dùng chung, router                                                                             |
| `client/src/styles/`, `client/src/i18n/` | CSS nền và tài nguyên ngôn ngữ                                                                           |
| `workflows/<id>/`                        | Workflow tích hợp, prompt và mẫu tài liệu                                                                |
| `subagents/claude/`                      | Mẫu subagent để cài vào repo người dùng                                                                  |
| `e2e/`                                   | Kiểm thử trình duyệt và môi trường giả lập                                                               |

Quy tắc import được kiểm tra trong [`architecture.test.ts`](../server/test/architecture.test.ts):

- `core/` không phụ thuộc module ở runtime; `shared/` không phụ thuộc `features/` hoặc `app/`; feature không phụ thuộc `app/`.
- Truy cập module hoặc feature khác qua `index.ts` của nó.
- `modules/workflow/**` không có edge tới `providers/{claude,codex,copilot}/**`, kể cả import kiểu; dùng `providerTraits` và `SessionPort`.
- CSS chỉ được import trong feature sở hữu, hoặc từ `app/`, `shared/`.
- Không có vòng phụ thuộc giữa client features, kể cả import kiểu; server modules không có vòng phụ thuộc runtime.

## Glossary và quy ước tên

| Thuật ngữ                            | Nghĩa                                                                                                                                     | Ví dụ tên                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                             | Một coding CLI TaskPilot chạy: `claude`, `copilot`, `codex`                                                                               | `ProviderId`, `PROVIDER_IDS`, `PROVIDER_LABELS`, `DEFAULT_PROVIDER`, `isProviderId`                                                                |
| Backend                              | Implementation provider trong tầng session                                                                                                | `ProviderBackend`, `BACKENDS`, `backendOf`                                                                                                         |
| Trait / port                         | Metadata thuần (không I/O) / hàm tùy chọn có I/O trên backend                                                                             | `ProviderTraits`, `providerTraits(id)`, `checkSubagent`, `promptInventory`, `turnMetrics`                                                          |
| Capability                           | Kết quả probe/khả năng của provider                                                                                                       | `ProviderCapability`, `CapabilityCheck`                                                                                                            |
| Subagent / custom agent              | Vai trò hoặc file agent tùy chỉnh của một provider                                                                                        | `ClaudeSubagentInfo`, `CopilotAgent`, `CodexAgent`                                                                                                 |
| App Server                           | `codex app-server` stdio, chỉ cho probe, inventory và quota                                                                               | `spawnCodexAppServer`, `CodexAppServerProcess`, `withCodexAppServer`                                                                               |
| Launcher                             | Lệnh chạy TUI/CLI của session                                                                                                             | `codexLauncher`, `codexLaunchSettings`                                                                                                             |
| Home CLI / home cấu hình             | Thư mục CLI tự đọc (`CODEX_HOME`, `COPILOT_HOME`) / thư mục TaskPilot đọc-ghi cấu hình (`TASKPILOT_*_HOME`); chuỗi rỗng coi như không đặt | `codexHome()`, `codexConfigHome()`, `copilotHome()`, `copilotConfigHome()`, `claudeHome()`                                                         |
| Requested / actual model             | Model gửi qua `--model` / model provider báo lại                                                                                          | `SessionMeta.model` (wire = requested), `SessionMeta.actualModel`, `RunAttempt.actualModel`                                                        |
| parse / read / fetch / create…Reader | Biến đổi dữ liệu có sẵn / đọc filesystem / gọi CLI, RPC, API / tạo hàm có cache                                                           | `parseHookInputs`, `parsePermissions`, `parseCopilotQuota`, `readCodexAgent`, `fetchCodexRateLimits`, `fetchCodexModels`, `createCliVersionReader` |
| Relative / absolute dir              | Đường dẫn trong prompt / trên filesystem                                                                                                  | `taskRelativeDir`, `taskAbsoluteDir`                                                                                                               |

Quy ước:

- Tên nội bộ dùng `ProviderId`; không định nghĩa lại kiểu thứ hai (`Agent`, `ConfigCli`, `AgentCli`). "Agent" chỉ còn cho subagent/custom agent và nhãn UI.
- Key wire và state giữ nguyên: `agent`, `subagent`, `model`, `cli` (query), `clis`, `codex:`, `agentUsage`, giá trị `MetricsSource`, `SessionFailure`. Đổi tên theo symbol (khai báo/import), không thay chuỗi toàn cục.
- Server: file `kebab-case.ts`; client: component `PascalCase.tsx`, module `kebab-case.ts` (`task-status.ts`, `query-client.ts`). Mỗi file một trách nhiệm (ví dụ `config/shared/` tách `CliContext`, `ConfigChrome`, `ScopeControls`).
- Mỗi provider có đúng một owner cho home trong `providers/<provider>/home.ts`; session và transcript dùng home CLI, chỉ `modules/config/**` dùng home cấu hình.
- Chi tiết provider ngoài `providers/<provider>/` và `sessions/backends/` đi qua trait/port; `modules/workflow` không import `providers/{claude,codex,copilot}`. Nhánh theo tên provider chỉ chấp nhận ở nơi khác biệt đến từ định dạng native thật (`modules/config/**`, client config) và nội dung prompt.
- Không giữ code chỉ phục vụ test hay giao thức đã bỏ; lịch sử nằm trong git (fixture App Server đã dọn ghi commit gốc trong [README](../server/test/fixtures/codex/README.md)).

## Ngôn ngữ giao diện

Hiện ứng dụng chỉ có tiếng Việt. Chuỗi client nằm trong `client/src/i18n/locales/vi/`, chia theo namespace; chuỗi server gửi ra giao diện nằm trong `server/src/core/locales/vi.ts`.

Thêm ngôn ngữ bằng bộ tài nguyên tương ứng cho mỗi namespace. Kiểu trong `i18next.d.ts` kiểm tra khóa dịch; `i18n:lint` và [`i18n.test.ts`](../server/test/i18n.test.ts) kiểm tra chuỗi viết trực tiếp trong code. Văn bản prompt, nhật ký và tên cột cần phân tích có ngoại lệ riêng trong bài kiểm thử.

Xem [Kiến trúc](SPEC.md) để hiểu luồng phiên CLI và workflow. Khi đổi hành vi, cập nhật tài liệu phụ trách nội dung đó rồi dẫn link từ nơi khác, tránh sao chép lại toàn bộ.

Tên file tích hợp: `cli-launcher.ts` dựng lệnh CLI, `account-usage.ts` đọc hạn mức native, `modules/usage/*-poller.ts` điều phối cập nhật store. Xem [ranh giới provider](../server/src/providers/README.md).
