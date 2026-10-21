# TaskPilot

Run Claude Code (and GitHub Copilot CLI) task workflows from your repo, with a person approving
each step.

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
- Optional: GitHub Copilot CLI (`copilot`, `npm install -g @github/copilot`) on `PATH`, signed in,
  to run steps or sessions with Copilot (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md#agents-claude-and-copilot)).
  TaskPilot writes its hooks into the repo's `.github/copilot/settings.local.json`; add that file
  to `.gitignore` yourself if the repo should not share it.

## Install and run

```bash
npm install
npm run build
npm link                       # optional: puts `taskpilot` on PATH

cd /path/to/repo && taskpilot --open
# or: node dist/server/index.js --repo /path/to/repo
```

The server prints a URL with a one-time token (`http://127.0.0.1:8790/?token=…`); open that one.
With `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` set, it prints the plain URL and the browser
shows a login screen instead.

| Option | Default |
|---|---|
| `--repo <path>` | current directory if it has `.claude/tasks`, else the last repo opened |
| `--host <addr>` | `127.0.0.1` (`$TASKPILOT_HOST`) |
| `--port <n>` | `8790` (`$TASKPILOT_PORT`) |
| `--open` | open the browser |

| Environment | Meaning |
|---|---|
| `TASKPILOT_HOME` | state directory, default `~/.taskpilot` |
| `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD` | log in with these instead of the token; set both or neither; changing them logs every browser out |
| `TASKPILOT_TOKEN` | without a login: fixed token instead of a random one per start; with a login: optional API token for scripts (`x-taskpilot-token` header) |
| `TASKPILOT_ALLOWED_HOSTS` | comma-separated hostnames accepted in `Host` / `Origin` besides loopback and `--host`, e.g. a reverse proxy's domain |
| `TASKPILOT_CLAUDE` | claude command, default `claude` |
| `TASKPILOT_COPILOT` | GitHub Copilot CLI command, default `copilot` |
| `TASKPILOT_CLAUDE_HOME` / `TASKPILOT_CLAUDE_JSON` | where user-scope config is read from, default `~/.claude` / `~/.claude.json` |

Variables not set in the environment are read from `.env` in the TaskPilot directory (next to
`package.json`, not the current directory); see `.env.example`. Precedence: command-line option,
then environment, then `.env`, then the default.

## Documentation

- [docs/GUIDE.md](docs/GUIDE.md) — task layout, the approval workflow, restarting a run, and the
  repo terminal and Claude plan usage in the footer.
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — editing CLAUDE.md, permissions, hooks, agents,
  commands, skills and MCP servers across scopes, and overriding the workflow in `.taskpilot/`.
- [docs/DEPLOY.md](docs/DEPLOY.md) — running as a systemd service, behind a reverse proxy, and the
  security model.
- [docs/DEVELOP.md](docs/DEVELOP.md) — dev commands, project layout, i18n.
- [docs/SPEC.md](docs/SPEC.md) — design notes, architecture and milestone history.
