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
  00-history.md          # decision log: start, feedback, approvals, cancel, restart (append-only)
  01-investigation.md    # OUTPUT written by Claude
  02-plan.md
  03-progress.md
  04-summary.md
  archive/<stamp>/       # 01-04 from before a restart; Claude rewrites them at the top level
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
- Stop fired but `done-when` not met (e.g. Claude asked a question): stay on the step (`waiting`);
  the card answers Claude through `POST /api/tasks/:key/run/reply` (pasted into the session,
  logged as "Ba trả lời"), or the user answers in the terminal.
- `GET /api/tasks/:key/run` returns Claude's numbered questions (`questions`, parsed by
  `modules/workflow/questions.ts`): at a gate from the done-when document's questions section, else
  from Claude's last message; while waiting from that message. `POST …/run/approve` takes an
  optional `note` (the answers), quoted in the "Ba duyệt" entry of the decision log.
- The run keeps the latest prompt pasted into its session (`sentPrompt`), shown on the task screen.
- Permission prompts are answered by the user in the terminal. `PermissionRequest` sets a "chờ quyền"
  badge on the session tab and task; `PostToolUse`, `Stop` or `UserPromptSubmit` clear it.
- The first prompt is held until the session reports `SessionStart` (after any trust dialog).
- Session exits mid-step, or TaskPilot restarts: the run becomes `interrupted`; "Gửi lại bước" resumes
  the session and re-sends the step.
- One task can have many sessions (tabs). The app records task ↔ session ids and can resume
  (`claude --resume <id>`).
- The engine appends to the task's decision log (`00-history.md`, §2) on start, reviewer feedback
  (quoted verbatim), approvals, cancel and restart; the built-in prompts read it first and append
  their own entry (`{{historyFile}}`, §4). A failed write only logs a warning; it never blocks the run.
- "Chạy lại từ đầu" (`POST /api/tasks/:key/run/restart`) starts over from step 1 in a new session,
  from any phase: a running session is stopped first (it stays listed, resumable), the task's `*.md`
  files are copied to `archive/<stamp>/` (not the decision log or `spec/`), then step 1 runs again
  and Claude rewrites them in place; its prompt (`{{previousRun}}`) lists the archived documents to
  read first (`restart.read` in the workflow).

## 4. Workflow definition

Built-in default in `workflows/default/`; a repo overrides it with its own copy in
`.claude/taskpilot/` (`workflow.yml` + prompt files, created from the Workflow page). Format
(`version: 2`), template variables and checks: [CONFIGURATION.md](CONFIGURATION.md#custom-workflow).
Each step declares its output documents; prompts are templates filled from the workflow (outputs,
shared rules, language, history file). The built-in prompts are written in Vietnamese; the wording
TaskPilot adds around them (skeleton rule, restart notice) lives in `modules/workflow/prompt-text.ts`. A run keeps a snapshot of the workflow it started with;
after a restart `{{previousRun}}` points Claude at the archived documents.

`bypassPermissions` is not accepted from a workflow file.

`agent` (`claude` | `copilot`) at the top sets the agent of every step; a step's own `agent`
overrides it. A step for another agent than the previous one runs in a new session of that agent
(`WorkflowEngine.enterStep`): the previous session is stopped, the switch is logged, and the run's
`sessionId` moves to the new session. Absent everywhere (and in snapshots saved before agents) =
`claude`.

## 5. Architecture

```
client/ — browser UI (Vite + React + xterm.js)
   │  HTTP (REST) + WebSocket (PTY I/O, events)
server/ — Node 24 + TypeScript + Fastify + @fastify/websocket
   ├─ RepoScanner      scan/watch .claude/tasks (chokidar)
   ├─ SessionManager   node-pty spawn/resume an agent (claude | copilot) through its backend,
   │                   many sessions per task, scrollback buffer
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
- The same `--settings` sets a `statusLine` that posts its input to `$TASKPILOT_HOOK_URL/statusline`
  (plan usage `rate_limits`, shown in the footer) and then runs the user's own status line, passed in
  `$TASKPILOT_STATUSLINE_CMD`: a `--settings` status line replaces the user's instead of merging.
- The child env must drop every `CLAUDE*` variable (see §7).
- Agents: `core/agents.ts` lists them (`AGENTS`); `modules/sessions/backends/` has one
  `AgentBackend` per agent: its launcher, how its hooks get in (`launchSettings` for a flag,
  `prepare` for a file), an optional `readyMarker` (terminal text that stands in for a SessionStart
  the agent fires late) and `normalize` (payload → Claude's hook fields, or null to drop it).
  Everything past the backend — `/hook/:event`, the engine, the activity feed — reads Claude's
  event names and payload fields. Copilot's backend writes `.github/copilot/settings.local.json`
  (§7, Copilot table). To add an agent (e.g. Codex): add it to `AGENTS` (TypeScript then asks for
  its entry in `BACKENDS` and in `/api/info`'s versions), write `core/<agent>/launch.ts` and
  `version.ts` and `modules/sessions/backends/<agent>.ts`, add it to `client/src/shared/agents.ts`,
  and spike its hooks first (§7).
- Repo terminal: a Claude session with no task, under the reserved key `@repo`
  (`GET`/`POST /api/repo/sessions`); excluded from task lists, workflow runs and the activity feed.
- i18n: client strings are i18next/react-i18next resources, one JSON file per feature namespace
  (`client/src/i18n/locales/vi/`); strings the server itself sends to the UI (toasts, errors, …) go
  through a second i18next instance (`server/src/core/i18n.ts`, `server/src/core/locales/vi.ts`).
  Only `vi` exists; `npm run i18n:lint` and a vitest scan guard against literal Vietnamese outside
  those resources and `modules/workflow/history.ts` (the decision log is a document Claude reads
  back, not UI).
- Config precedence: agents/commands/skills and MCP pages split into one tab per folder/scope;
  `client/src/features/config/shared/precedence.ts` flags an item shadowed by the same name in a
  higher-precedence scope, following Claude Code's own precedence (MCP local > project > user,
  agents project > user, skills and commands user > project).

### Server modules

| Module | Routes | Main files |
|---|---|---|
| `auth` | `/api/auth`, `/api/login`, `/api/logout` (+ Host/Origin/session guard) | `sessions.ts`, `security.ts` |
| `repo` | `/api/repo`, `/api/inventory`, `/api/info` | `context.ts` (selected repo), `inventory.ts` |
| `tasks` | `/api/tasks`, `/api/tasks/:key`, `/api/tasks/:key/file` | `scan.ts`, `watcher.ts` |
| `sessions` | `/api/tasks/:key/sessions`, `/api/repo/sessions`, `/api/sessions/:id/*` (+ PTY WebSocket) | `manager.ts`, `hooks.ts` |
| `hooks` | `/hook/:event`, `/hook/statusline` | `routes.ts` |
| `env` | `/api/env`, `/api/env/:key` | `store.ts` |
| `usage` | `/api/usage` | `store.ts` |
| `activity` | `/api/tasks/:key/activity` | `store.ts`, `describe.ts` |
| `workflow` | `/api/tasks/:key/run*` | `engine.ts`, `definition.ts`, `vars.ts`, `prompt-text.ts`, `questions.ts`, `stage.ts`, `history.ts`, `archive.ts` |
| `events` | `/api/events` (SSE) | hub in `core/events.ts` |
| `config` | `/api/config/*`, `/api/backups*` | one sub-folder per group: `memory`, `settings`, `hooks`, `library`, `mcp`, `workflow` (`/api/config/workflow*`), `backups`, `codegraph`, `shared` |

`app.ts` creates the services, wires their events (hook → activity + engine, exit → engine,
status line → usage, changes → SSE) and registers each module's routes; the code layout and import
rules are in [DEVELOP.md](DEVELOP.md).

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
| `--settings` statusLine (TPL-004, claude 2.1.304) | **Replaces** the user's status line. Input has `session_id`, `cost`; `rate_limits.five_hour`/`seven_day` (`used_percentage`, `resets_at` epoch s) only after the first API response. |
| `--resume <id>` | Keeps the same session id (a new id only with `--fork-session`); history is restored. |
| Bracketed paste, multi-line prompt | Arrives as **one** user message with newlines intact. |
| Writing into `.claude/tasks/` | `permission_mode: auto` → no prompt. `default` → prompt *"Do you want to create 02-plan.md?"* with option 2 *"allow Claude to edit files in this project's .claude folder for this session"*. |
| Transcript JSONL | Written only when the child env has no `CLAUDE*` vars. With inherited `CLAUDECODE=1` / `CLAUDE_CODE_CHILD_SESSION=1` the transcript is never persisted. |
| Hook timing (M3 spike) | `SessionStart` ~1 s after spawn; a prompt pasted right after it is accepted. `PermissionRequest` fires as the prompt appears; `Notification` ~6 s later; `PostToolUse` after approval. |
| Tool hooks (UI pass) | `PreToolUse`/`PostToolUse` carry `tool_use_id` and `tool_input`; `PostToolUse` has `duration_ms`. A failing tool (non-zero exit) fires **`PostToolUseFailure`** (with `error`), not `PostToolUse`. |
| MCP `${VAR}` source (C2 spike) | Expanded from the claude **process** environment only. `env` in `.claude/settings.local.json` does **not** reach MCP servers (`claude mcp get`: failed with settings env, connected with process env). Project `.mcp.json` servers stay "Pending approval" until approved in claude; `enabledMcpjsonServers` in settings.local.json did not approve them. |
| First run in a new folder | Trust dialog appears; default choice is **"No, exit"**. Leave it to the user in the terminal; never auto-answer. |

### GitHub Copilot CLI spike (TPL-009, 2026-10-21, copilot 1.0.100–1.0.101, interactive via node-pty)

| Question | Result |
|---|---|
| `--session-id <uuid>` | Creates the session with that id, and resumes it on a later start (context kept, `SessionStart.source: "resume"`). No separate resume flag needed. |
| Hook config | No `--settings` flag. Hooks in `.github/copilot/settings.local.json`, flat entries `{type: "command", bash, timeoutSec}`. Declared with **PascalCase** names (`Stop`…) Copilot sends Claude-style snake_case payloads (`session_id`, `tool_name` as Claude's `Bash`/`Read`/`Edit`, `tool_input`, `transcript_path`); camelCase names get camelCase payloads. |
| `PermissionRequest` | Still camelCase despite the PascalCase name: `sessionId`, `toolName: "bash"`, `toolInput`. Not fired for pre-approved tools. |
| `SessionStart` | **Not at startup**: fires only with the first prompt, next to `UserPromptSubmit`. TaskPilot treats the input box footer `/ commands` in the terminal output as SessionStart and drops Copilot's late one. |
| Tool hooks | No `tool_use_id`, no `duration_ms`; parallel calls share a timestamp. A shell command exiting non-zero is a `PostToolUse` (`result_type: "success"`), not `PostToolUseFailure`. |
| `Stop` | No last message: read the last non-empty `assistant.message` `data.content` from `transcript_path` (`~/.copilot/session-state/<id>/events.jsonl`). |
| First run in a folder | "Confirm folder trust": 1. Yes (this session) / 2. Yes, and remember / 3. No. No hook fires before the answer; after "Yes" the repo hooks load in that same session. `trustedFolders` in `~/.copilot/settings.json` does not skip the question. The footer `/ commands` appears only after it. Leave it to the user; never auto-answer. |
| Bracketed paste, multi-line | One prompt with newlines intact, submitted by `\r` 200 ms later. |
| `statusLine` | Runs only from `~/.copilot/settings.json`, not from the repo's `settings.local.json`. Input: `session_id`, `model`, `cost.total_premium_requests`, `ai_used`, `context_window`; **no account quota**, so no Copilot plan usage in the footer. |
| Settings files | JSONC (comments). Precedence: user < `.github/copilot/settings.json` < `settings.local.json` < env < flags. Copilot also runs hooks from `.claude/settings.json` and `.claude/settings.local.json`. |

## 8. Open items

- Trust dialog vs. `SessionStart` order is inferred, not verified: in a never-trusted folder the first
  prompt waits for `SessionStart`; if it never arrives, "Gửi lại bước" pastes anyway.
- Copilot plan usage: its status line has no quota and runs only from the user's settings; options
  are a user-level status line or the Copilot SDK's `account.getQuota`.
- Leader-driven runs: Claude reads its plan and hands sub-tasks to member agents (Copilot, later
  Codex) while running; TPL-009 only assigns agents per step.

## 9. Milestones

- **M0** spike — done (§7).
- **M1** repo scan, task list, view `spec/` and output files — done.
- **M2** session manager: multiple tabs per task, resume, scrollback across page reloads — done.
- **M3** workflow engine, approve/feedback gates, hook badges — done.
- **Phase A** app shell — done: "Instrument panel" design (canvas mockups), sidebar with Workspace /
  Claude config / Integrations groups and nested task list, ⌘K palette, status bar, repo overview
  (needs-you hero, running task pulse, task counts, CLAUDE.md, MCP and .claude inventory via
  `/api/inventory`), task table, config pages as placeholders.
- **Phase B** read-only config pages — done: `/api/config/{memory,settings,hooks,agents,commands,skills,mcp}`
  over project, local and user scopes (`~/.claude/`, `~/.claude.json`; override with
  `TASKPILOT_CLAUDE_HOME` / `TASKPILOT_CLAUDE_JSON`). CLAUDE.md: outline, recursive `@import`s, token
  estimate, checks (missing imports, unknown `npm run` scripts, token-like secrets). Secrets never
  leave the server: env/header values are masked unless they are `${VAR}` references (optionally
  with a short prefix such as `Bearer `), URL credentials in MCP args are hidden; MCP servers report
  `${VAR}`s that are not set.
- **Phase C1** — done: editing CLAUDE.md (project, local, global) in CodeMirror and allow/ask/deny
  rules + default mode of each settings file (global included). Every save: diff review first
  (settings diffs are built from masked JSON), conflict check against the hash the user started
  from (409 if the file changed meanwhile), backup to `~/.taskpilot/backups/<id>/` (0700), atomic
  write keeping the file mode, symlinks refused, target re-checked against an allow-list of Claude
  config paths. "Lịch sử thay đổi" lists backups, shows the diff and restores (backing up first).
  `bypassPermissions` is not offered as a default mode.
- **Phase C2** — done: command hooks per settings file (other hook types kept), create/edit/delete
  agents, commands and skills (delete = backup then remove; skills: SKILL.md only), MCP servers:
  - project (`.mcp.json`): written by TaskPilot with backups; values marked secret become `${VAR}`
    and the value goes to TaskPilot's env store (`~/.taskpilot/env.json`, 0600), which is added to
    the environment of every claude session TaskPilot starts;
  - local/user (`~/.claude.json`): changed only through `claude mcp add-json` / `remove`, the
    previous entry kept as a backup and restorable the same way (TaskPilot never writes that file);
    secret values travel in `add-json`'s argv for that short call;
  - connection check: `claude mcp get <name>` with the env store; only the Status line is used
    because that command prints environment values in clear.
- **UI** mission control — done: workflow is the main view (stepper, "what Claude is doing now",
  live activity feed, gate card with doc preview and Claude's closing message); the terminal is a
  drawer that opens on demand or on a permission prompt. Client split into `api/`, `components/`,
  `features/*`, `styles/`.
- **M4** polish — done: `web/` renamed `client/`, `taskpilot` CLI (cwd as repo, `--open`, port errors),
  flight-strip UI (state bands, workflow drawn as a route), README, review fixes.
- **TPL-001/002/003** toolbars & scope tabs — done: every config page's file actions moved from the
  page header into a toolbar below it (`ConfigToolbar`, then the shared `Toolbar` for Task, MCP and
  Agents/Commands/Skills); Settings and Hooks show one file per scope tab. Agents, commands and
  skills split into one tab per folder (`.claude/<kind>` / `~/.claude/<kind>`); MCP into one tab per
  scope (`.mcp.json`, `~/.claude.json` for this repo, `~/.claude.json`), both like the CLAUDE.md
  page; an item shadowed by another scope is flagged (§5). Session cookie moved to
  `@fastify/cookie`; CLAUDE.md and outline heading parsing moved to `marked.lexer()`
  (`server/src/core/markdown.ts`).
- **TPL-002** decision log & restart — done: see §3 and §5; the engine appends to `00-history.md`
  and "Chạy lại từ đầu" restarts a run from step 1 in a new session, archiving the previous
  documents first.
- **TPL-004** repo terminal & usage footer — done: see §5 and the spike table (§7); a `@repo`
  session reachable from the status bar on every page, next to Claude's plan-usage readout.
- **TPL-005** i18n — done: see §5; UI strings moved into i18next resources on the client and the
  server, guarded by `npm run i18n:lint` and a vitest scan for stray Vietnamese literals.
- **TPL-007** code layout — done: server modules + core, client features with entry points +
  shared, tests mirror the source tree, import rules checked by a test (§5, "Server modules").
- **TPL-008** default prompts — done: built-in prompts in Vietnamese and shorter (on-reject prompts
  carry no skeletons; a size budget is tested), prompts previewed with a sample task, the prompt
  sent to a task kept and shown, a *Định dạng tài liệu* page (`#/formats`), an override guide and
  per-file restore on the Workflow page, and Claude's questions answered one by one (§3).
- **TPL-009** GitHub Copilot CLI as a second session agent — done: `agent` per workflow and per
  step, a new session when the agent changes, one backend per agent (§5), the Copilot spike (§7).
- **Docs split** — done: README trimmed to the pitch, requirements and install/run; everything else
  moved into `docs/GUIDE.md` (daily use), `docs/CONFIGURATION.md` (Claude config, custom workflow),
  `docs/DEPLOY.md` (service, reverse proxy, security) and `docs/DEVELOP.md` (dev commands, layout,
  i18n), linked from a `## Documentation` section in the README.

The legacy Java/Backlog implementation was removed from this branch; it remains in git history (`995f4e0`).
