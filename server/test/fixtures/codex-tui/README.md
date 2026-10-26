# Fixture Codex TUI

Payload hook, rollout transcript và trích màn hình thật của `codex` TUI (không phải app-server), thu trong spike REFACTOR-001 việc 1. Báo cáo đầy đủ: `.claude/tasks/REFACTOR-001/spike-codex-tui.md`.

- Phiên bản: **`codex-cli 0.163.0`** (Linux x86_64, standalone musl, tài khoản ChatGPT Plus), ngày 2026-10-26.
- Codex chạy trong `node-pty` 120×32 với `--no-daemon -c check_for_update_on_startup=false -m gpt-6-luna -c model_reasoning_effort="low" -s workspace-write -a on-request`. Một số lần chạy dùng `--no-alt-screen`. Prompt được gửi bằng bracketed paste + Enter sau 200 ms, giống `PtyTransport.paste`.
- Hook cấp per-run bằng `-c 'hooks.<Event>=[{hooks=[{type="command",command="…"}]}]'` cho đủ 12 sự kiện. Lệnh hook ghi stdin (JSON) ra file.
- Đã thay đường dẫn: repo thử → `<REPO>`, thư mục spike → `<SPIKE>`, scratchpad → `<TMP>`, `~/.codex` → `<CODEX_HOME>`, home → `<HOME>`. Đã bỏ `creator_user_id`/`creator_account_id`. `session_id`/`turn_id`/`tool_use_id` giữ nguyên (id ngẫu nhiên của thread thử).

## File

| File                                   | Nội dung                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks-turn-approval.jsonl`            | Phiên mới, prompt nhiều dòng: `SessionStart(startup)` → `UserPromptSubmit` → Bash `ls -a` → Bash `touch ../outside-approval.txt` cần approval (`PreToolUse` → `PermissionRequest` → duyệt trong TUI → `PostToolUse`) → `Stop`                                                                                                   |
| `hooks-edit-fail-interrupt-quit.jsonl` | Bash lỗi (`ls /nonexistent…`, `tool_response` chỉ là text) → `apply_patch` tạo file → Bash `sleep 40` → Esc → `Interrupt` (không `Stop`) → `/quit` → `SessionEnd(reason=other)`                                                                                                                                                 |
| `hooks-resume.jsonl`                   | `codex resume <session_id>` của thread trong `hooks-turn-approval`: `SessionStart(source=resume)` cùng `session_id` và `transcript_path` → `UserPromptSubmit` → `Stop`                                                                                                                                                          |
| `hooks-untrusted-session-start.jsonl`  | Hook `SessionStart` đổi lệnh, người dùng chọn "Continue without trusting": không có `SessionStart`, các hook đã trust vẫn chạy                                                                                                                                                                                                  |
| `rollout-approval-then-resume.jsonl`   | Rollout của thread approval, có thêm lượt resume nối vào cùng file. Đã lọc: `session_meta` (bỏ `base_instructions`), `turn_context`, `thread_settings_applied`, `token_count`, `token_usage_record`, `task_started/complete`, `item_completed` (`CommandExecution`/`AgentMessage` đầy đủ, loại khác rút gọn), message assistant |
| `rollout-edit-fail-interrupt.jsonl`    | Rollout của thread edit/lỗi/interrupt, cùng bộ lọc; có `CommandExecution.exit_code` (`2`, `-1`), `turn_aborted(reason=interrupted)`                                                                                                                                                                                             |
| `screens.txt`                          | Trích màn hình đã bỏ ANSI kèm mốc thời gian: khởi động, Folder trust, Hooks need review, Working directory khi resume khác cwd, approval, Update available, cảnh báo F2, byte thô quanh dấu `·` của footer                                                                                                                      |

Mỗi dòng `hooks-*.jsonl` là `{"event": <tên sự kiện của hook>, "payload": <stdin JSON Codex gửi cho hook>}`.

## Thu lại

Khi đổi phiên bản Codex, chạy lại các kịch bản trên rồi so sánh. Cần lưu ý:

- **Backup `~/.codex/config.toml` trước khi thu.** Codex ghi trust folder (`[projects."<path>"]`) và trust hook (`[hooks.state."/<session-flags>/config.toml:<event>:0:0"]`) vào file này. Khôi phục bản backup sau khi thu xong.
- Luôn truyền `-c check_for_update_on_startup=false`. Nếu thiếu, hộp thoại "Update available" có thể hiện ra, và một Enter tự động sẽ chạy cập nhật Codex.
- Đặt `TASKPILOT_HOOK_URL`/`TASKPILOT_HOOK_TOKEN` riêng cho tiến trình thu. Hook kế thừa env của `codex`.
