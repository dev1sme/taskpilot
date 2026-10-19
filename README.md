# TaskPilot

Run Claude Code task workflows from your repo, with a person approving each step.

TaskPilot reads tasks from `.claude/tasks/<key>/spec/*.md`, opens real interactive `claude`
sessions in an embedded terminal, feeds each workflow step into the session as a prompt and stops
at approval gates. Claude runs exactly as in your own terminal: your `CLAUDE.md`, hooks,
permissions and settings all apply, and you can type into the session at any time.

```
spec/*.md ──▶ Investigate ──▶ ◆ you approve 02-plan.md ──▶ Implement ──▶ ◆ you approve 04-summary.md ──▶ done
                   ▲                  │ feedback                              │ feedback
                   └──────────────────┘                                       └──▶ Claude revises
```

## Requirements

- Node 22+ (tested on 24), with a C/C++ toolchain for `node-pty` (`g++`, `make`, `python3`)
- Claude Code (`claude`) on `PATH`, signed in
- `curl` on `PATH`: session hooks use it to report back to TaskPilot

## Install and run

```bash
npm install
npm run build
npm link                       # optional: puts `taskpilot` on PATH

cd /path/to/repo && taskpilot --open
# or: node dist/server/index.js --repo /path/to/repo
```

The server prints a URL with a one-time token (`http://127.0.0.1:8790/?token=…`); open that one.

| Option | Default |
|---|---|
| `--repo <path>` | current directory if it has `.claude/tasks`, else the last repo opened |
| `--host <addr>` | `127.0.0.1` (`$TASKPILOT_HOST`) |
| `--port <n>` | `8790` (`$TASKPILOT_PORT`) |
| `--open` | open the browser |

| Environment | Meaning |
|---|---|
| `TASKPILOT_HOME` | state directory, default `~/.taskpilot` |
| `TASKPILOT_TOKEN` | fixed UI token instead of a random one per start; never passed to sessions |
| `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` | HTTP basic auth on every request except hook callbacks; set both or neither; never passed to sessions |
| `TASKPILOT_ALLOWED_HOSTS` | comma-separated hostnames accepted in `Host` / `Origin` besides loopback and `--host`, e.g. a reverse proxy's domain |
| `TASKPILOT_CLAUDE` | claude command, default `claude` |
| `TASKPILOT_CLAUDE_HOME` / `TASKPILOT_CLAUDE_JSON` | where user-scope config is read from, default `~/.claude` / `~/.claude.json` |

Variables not set in the environment are read from `.env` in the TaskPilot directory (next to
`package.json`, not the current directory); see `.env.example`. Precedence: command-line option,
then environment, then `.env`, then the default.

## Run as a service

```bash
cp .env.example .env && chmod 600 .env   # set TASKPILOT_TOKEN, and HOST / ALLOWED_HOSTS if proxied
make service-install                     # build, write ~/.config/systemd/user/taskpilot.service, start
make service-restart                     # after pulling new code or editing .env
make service-logs                        # or service-status, service-uninstall
```

The unit is a systemd *user* service so `claude` runs with your own `~/.claude`. It uses the `node`
and `claude` on your `PATH` at install time: run `make service-install` again after changing the
Node version. It only runs while you are logged in unless lingering is on
(`loginctl enable-linger $USER`). Restarting stops running sessions; resume them from the UI.

Behind a reverse proxy in Docker, listen on the docker0 address (`TASKPILOT_HOST=172.17.0.1`),
proxy to `http://host.docker.internal:8790` with WebSocket upgrade headers, and list the proxy's
domain in `TASKPILOT_ALLOWED_HOSTS`. Hook callbacks go straight to the listen address, so the proxy
can refuse `/hook/`. Set `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` (the token alone
guards a shell) and keep the proxy's access log off for it: the token travels in query strings.

## Claude configuration

The sidebar's *Cấu hình Claude* and *Tích hợp* sections show the repo's CLAUDE.md files, settings
and permissions, hooks, agents, commands, skills and MCP servers, merged across project, local and
user scopes. Everything can be edited: CLAUDE.md files, permission rules, hooks, agents, commands, skills and MCP
servers. Every save shows a diff first, refuses to overwrite a file that changed since you opened
it, and keeps a backup of the old version in `~/.taskpilot/backups/` (restore it from
*Lịch sử thay đổi*).

MCP secrets: for servers in the shared `.mcp.json`, mark a value as secret and TaskPilot writes
`${VAR}` in the file and keeps the value in its own env store (`~/.taskpilot/env.json`), passed to
the claude sessions it starts. Claude Code reads `${VAR}` from its process environment only, so
sessions you start yourself need the variable in your shell. Local and user servers are changed
through `claude mcp`; "Kiểm tra kết nối" asks `claude mcp get` and shows only the status. Secret values (env, headers, credentials in URLs)
are masked on the server and never sent to the browser; `${VAR}` references are shown, and MCP
servers whose variables are not set are flagged.

## Tasks

```
<repo>/.claude/tasks/PROJ-123/
  spec/                  # you write the requirements here (any *.md, subfolders allowed)
  01-investigation.md    # written by Claude
  02-plan.md
  03-progress.md
  04-summary.md
```

The first `# Heading` of the first spec file becomes the task title.

## Using it

1. Pick a task in the left column. Tasks that need you (waiting for review, for a permission
   prompt, or for an answer) are listed first with an amber band.
2. **Bắt đầu quy trình** opens a new Claude session and sends the investigate prompt. The screen
   shows the workflow as a stepper, what Claude is doing right now, and a live feed of every file
   read, command run and document written. The terminal stays folded at the bottom; it opens by
   itself when Claude asks for a permission. If Claude asks to trust the folder, answer there.
3. At a gate, the review card shows Claude's closing message and the document it wrote; **Duyệt**
   moves on, **Gửi góp ý** sends feedback and Claude revises in the same session.
4. If Claude ends its turn without writing the expected file (for example it asked you a question),
   reply in the terminal. **Gửi lại bước** re-sends the step; if the session has exited it is resumed
   first (`claude --resume`, same session id).

A task can have several sessions (tabs). **+ Session mới** opens a free session outside the workflow.
Sessions survive page reloads; after a TaskPilot restart they show as stopped and can be resumed.

## Custom workflow

Put `.claude/workflow.yml` in the repo to replace the built-in one (`workflows/default/`):

```yaml
permission-mode: acceptEdits     # optional: default | acceptEdits | plan | auto
steps:
  - id: investigate
    title: Điều tra & lên kế hoạch
    prompt: investigate.md       # looked up next to workflow.yml, then in workflows/default/
    done-when: { file: 02-plan.md }
    gate: approve                # or none: continue without stopping
    on-reject: revise-plan.md
  - id: implement
    prompt: implement.md
    done-when: { file: 04-summary.md }
    gate: approve
```

Prompt templates can use `{{key}}`, `{{title}}`, `{{taskDir}}`, `{{specDir}}` and, in `on-reject`
prompts, `{{feedback}}`. A step counts as done only when its `done-when` file was written after the
step's prompt was sent.

## Security

The embedded terminal is a shell on your machine, so TaskPilot:

- listens on `127.0.0.1` by default and rejects `Host` / `Origin` headers other than loopback, the
  listen address and `TASKPILOT_ALLOWED_HOSTS` (DNS rebinding, cross-site WebSockets);
- requires the per-start token on every API call and WebSocket, and HTTP basic auth on every
  request when `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` are set;
- authenticates hook callbacks with a token per session process.

## Develop

```bash
npm run dev:server   # API on 127.0.0.1:8791, token "dev" (tsx watch); the service keeps :8790
npm run dev:client   # UI on :5173, open http://127.0.0.1:5173/?token=dev
npm test
npm run typecheck
```

Layout:

- `server/src/`: `sessions/` (node-pty, hooks), `workflow/` (engine, workflow files),
  `activity/` (hook events → feed), `repo/` (task scanning)
- `client/src/`: `app/` (shell, hash router, workspace state), `api/`, `components/`,
  `features/{shell,overview,tasks,task,workflow,activity,docs,sessions,repo,config}/`
  (each feature keeps its own CSS), `styles/` (tokens, base)
- `workflows/default/`: built-in workflow and prompts

Design notes: [docs/SPEC.md](docs/SPEC.md).
