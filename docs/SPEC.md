# TaskPilot — Spec v0

## 1. Goal

A local web app. Point it at a repo; it lists the tasks under `.claude/tasks/`. Each task runs one or
more **real interactive `claude` sessions** in an embedded terminal. The app feeds each workflow step
into the session as a prompt and stops at human approval gates.

The app does not replace Claude Code: hooks, `CLAUDE.md`, permissions and settings behave exactly as
in a normal terminal session. The user can type into the terminal at any time.

## 2. Task layout in the repo

```
<repo>/.claude/tasks/<key>/
  spec/                  # INPUT: requirements written by the user (read-only for the app)
    *.md
  01-investigation.md    # OUTPUT written by Claude
  02-plan.md
  03-progress.md
  04-summary.md
```

A directory is a task when `<key>/spec/` contains at least one `.md` file.

## 3. Run flow

```
[Start] → spawn PTY: claude --session-id <uuid> --settings <hooks-json>   (cwd = repo)
  step investigate: paste prompt → Claude reads spec/, investigates, writes 01 + 02
     ⟶ Stop hook → check done-when (02-plan.md exists)
  gate: UI shows 02-plan.md → [Approve] / [Feedback → paste revise prompt → loop]
  step implement: paste prompt → Claude codes, updates 03, writes 04
     ⟶ Stop hook → check done-when (04-summary.md exists)
  gate: review → [Finish] / [Request changes]
  done
```

- The engine advances only when the Stop hook reports the turn ended **and** `done-when` holds.
- Stop fired but `done-when` not met (e.g. Claude asked a question): stay on the step and show
  "Claude is waiting for you in the terminal".
- Permission prompts are answered by the user in the terminal; the UI shows a badge (see §8 open items).
- One task can have many sessions (tabs). The app records task ↔ session ids and can resume
  (`claude --resume <id>`).

## 4. Workflow definition

Built-in default; a repo may override it with `.claude/workflow.yml`.

```yaml
steps:
  - id: investigate
    prompt: investigate.md        # template vars: {{key}} {{taskDir}} {{specDir}}
    done-when: { file: "02-plan.md" }
    gate: approve
    on-reject: revise.md          # var: {{feedback}}
  - id: implement
    prompt: implement.md
    done-when: { file: "04-summary.md" }
    gate: approve
```

## 5. Architecture

```
Browser (Vite + React + xterm.js)
   │  HTTP (REST) + WebSocket (PTY I/O, events)
Server (Node 24 + TypeScript + Fastify + @fastify/websocket)
   ├─ RepoScanner      scan/watch .claude/tasks (chokidar)
   ├─ SessionManager   node-pty spawn/resume claude, many sessions per task, scrollback buffer
   ├─ HookReceiver     POST /hook/stop, /hook/notify  ← curl from claude hooks
   ├─ TranscriptReader ~/.claude/projects/<enc>/<id>.jsonl (turn results, history)
   ├─ WorkflowEngine   per-run state machine: step → wait-stop → check → gate
   └─ StateStore       ~/.taskpilot/<repo-hash>/state.json (task ↔ sessions, current step)
```

- Prompt injection into the PTY: bracketed paste `ESC[200~ … ESC[201~`, then `\r`.
- Hooks are passed with `--settings` (inline JSON); the user's `~/.claude/settings.json` is never touched.
- The child env must drop every `CLAUDE*` variable (see §7).

## 6. Security

The embedded terminal is shell-equivalent access to the machine.

- Bind `127.0.0.1` only; reject requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>`
  (DNS rebinding).
- Random token per app start, printed in the URL; required on the API and WebSocket.
- Hook endpoint: loopback only, plus a per-session token.

## 7. M0 spike results (2026-10-19, claude 2.1.303)

| Question | Result |
|---|---|
| `--session-id <uuid>` | Honoured; hook payload `session_id` matches. |
| `--settings` hooks merge with global settings? | **Merge.** Global `SessionStart`, `UserPromptSubmit`, `PostToolUse` hooks ran alongside the injected `Stop` hook. |
| Stop hook payload | JSON on stdin: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `last_assistant_message`, … |
| `--resume <id>` | Keeps the same session id (a new id only with `--fork-session`); history is restored. |
| Bracketed paste, multi-line prompt | Arrives as **one** user message with newlines intact. |
| Writing into `.claude/tasks/` | `permission_mode: auto` → no prompt. `default` → prompt *"Do you want to create 02-plan.md?"* with option 2 *"allow Claude to edit files in this project's .claude folder for this session"*. |
| Transcript JSONL | Written only when the child env has no `CLAUDE*` vars. With inherited `CLAUDECODE=1` / `CLAUDE_CODE_CHILD_SESSION=1` the transcript is never persisted. |
| First run in a new folder | Trust dialog appears; default choice is **"No, exit"**. Leave it to the user in the terminal; never auto-answer. |

## 8. Open items

- `Notification` hook did not fire for a permission prompt answered within ~0.5 s. Check timing or use
  a permission-specific hook in M3.
- Decide the permission mode default per step (inherit user default vs. explicit `--permission-mode`).

## 9. Milestones

- **M0** spike — done (§7).
- **M1** repo scan, task list, view `spec/` and output files — done.
- **M2** session manager: multiple tabs per task, resume, scrollback across page reloads — done.
- **M3** workflow engine, approve/feedback gates, hook badges.
- **M4** polish: README, launcher script, tests for engine and scanner.

The legacy Java/Backlog implementation was removed from this branch; it remains in git history (`995f4e0`).
