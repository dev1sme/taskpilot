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
- Permission prompts are answered by the user in the terminal. `PermissionRequest` sets a "chờ quyền"
  badge on the session tab and task; `PostToolUse`, `Stop` or `UserPromptSubmit` clear it.
- The first prompt is held until the session reports `SessionStart` (after any trust dialog).
- Session exits mid-step, or TaskPilot restarts: the run becomes `interrupted`; "Gửi lại bước" resumes
  the session and re-sends the step.
- One task can have many sessions (tabs). The app records task ↔ session ids and can resume
  (`claude --resume <id>`).

## 4. Workflow definition

Built-in default in `workflows/default/`; a repo may override it with `.claude/workflow.yml`.
Prompt files are looked up next to that file first, then in the defaults.

```yaml
permission-mode: acceptEdits      # optional: default | acceptEdits | plan | auto; absent = user's own
steps:
  - id: investigate
    title: Điều tra & lên kế hoạch
    prompt: investigate.md        # vars: {{key}} {{title}} {{taskDir}} {{specDir}}
    done-when: { file: 02-plan.md }   # must be written after the prompt was sent
    gate: approve                 # approve | none (none = advance automatically)
    on-reject: revise-plan.md     # var: {{feedback}}
  - id: implement
    prompt: implement.md
    done-when: { file: 04-summary.md }
    gate: approve
    on-reject: revise-implementation.md
```

`bypassPermissions` is not accepted from a repo file.

## 5. Architecture

```
client/ — browser UI (Vite + React + xterm.js)
   │  HTTP (REST) + WebSocket (PTY I/O, events)
server/ — Node 24 + TypeScript + Fastify + @fastify/websocket
   ├─ RepoScanner      scan/watch .claude/tasks (chokidar)
   ├─ SessionManager   node-pty spawn/resume claude, many sessions per task, scrollback buffer
   ├─ /hook/:event     SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest,
   │                   PostToolUse, PostToolUseFailure, Stop ← curl
   ├─ ActivityStore    hook events → per-session feed (<state>/activity/<id>.jsonl), pushed over SSE
   ├─ WorkflowEngine   per-run state machine: step → wait-stop → check → gate
   └─ StateStore       ~/.taskpilot/state.json (sessions, runs, last repo)
```

- Prompt injection into the PTY: bracketed paste `ESC[200~ … ESC[201~`, then `\r`.
- Hooks are passed with `--settings` (inline JSON); the user's `~/.claude/settings.json` is never touched.
  Each hook command curls `$TASKPILOT_HOOK_URL/<event>` with `$TASKPILOT_HOOK_TOKEN`, both set in the
  child env per spawn. Hooks need `curl` on `PATH`.
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
| Hook timing (M3 spike) | `SessionStart` ~1 s after spawn; a prompt pasted right after it is accepted. `PermissionRequest` fires as the prompt appears; `Notification` ~6 s later; `PostToolUse` after approval. |
| Tool hooks (UI pass) | `PreToolUse`/`PostToolUse` carry `tool_use_id` and `tool_input`; `PostToolUse` has `duration_ms`. A failing tool (non-zero exit) fires **`PostToolUseFailure`** (with `error`), not `PostToolUse`. |
| First run in a new folder | Trust dialog appears; default choice is **"No, exit"**. Leave it to the user in the terminal; never auto-answer. |

## 8. Open items

- Trust dialog vs. `SessionStart` order is inferred, not verified: in a never-trusted folder the first
  prompt waits for `SessionStart`; if it never arrives, "Gửi lại bước" pastes anyway.

## 9. Milestones

- **M0** spike — done (§7).
- **M1** repo scan, task list, view `spec/` and output files — done.
- **M2** session manager: multiple tabs per task, resume, scrollback across page reloads — done.
- **M3** workflow engine, approve/feedback gates, hook badges — done.
- **Phase A** app shell — done: "Instrument panel" design (canvas mockups), sidebar with Workspace /
  Claude config / Integrations groups and nested task list, ⌘K palette, status bar, repo overview
  (needs-you hero, running task pulse, task counts, CLAUDE.md, MCP and .claude inventory via
  `/api/inventory`), task table, config pages as placeholders.
- **Phase B** read-only config pages (CLAUDE.md, settings & permissions, hooks, agents, commands,
  skills, MCP). **Phase C** editors with diff preview and safe writes, MCP connection check.
- **UI** mission control — done: workflow is the main view (stepper, "what Claude is doing now",
  live activity feed, gate card with doc preview and Claude's closing message); the terminal is a
  drawer that opens on demand or on a permission prompt. Client split into `api/`, `components/`,
  `features/*`, `styles/`.
- **M4** polish — done: `web/` renamed `client/`, `taskpilot` CLI (cwd as repo, `--open`, port errors),
  flight-strip UI (state bands, workflow drawn as a route), README, review fixes.

The legacy Java/Backlog implementation was removed from this branch; it remains in git history (`995f4e0`).
