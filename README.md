# TaskPilot

Local web app that runs Claude Code task workflows for a repo: it reads tasks from
`.claude/tasks/<key>/spec/*.md`, runs real interactive `claude` sessions in an embedded
terminal, feeds each workflow step into the session and waits at human approval gates.

Design and status: [docs/SPEC.md](docs/SPEC.md).

## Run

Requires Node 22+, Claude Code (`claude`) and `curl` on `PATH` (hooks report back to TaskPilot with curl).

```bash
npm install
npm run build
node dist/server/index.js --repo /path/to/repo   # open the printed URL (it carries ?token=…)
```

The server binds `127.0.0.1` only. App state lives in `~/.taskpilot/` (override with `TASKPILOT_HOME`).

## Workflow

Each task is `.claude/tasks/<key>/spec/*.md`. "Bắt đầu quy trình" opens a Claude session and runs the
steps in `workflows/default/workflow.yml` (investigate → plan gate → implement → review gate).
Put a `.claude/workflow.yml` in the repo to change the steps or prompts; see [docs/SPEC.md](docs/SPEC.md) §4.

## Develop

```bash
TASKPILOT_TOKEN=dev npm run dev:server   # API on :8790
npm run dev:web                          # UI on :5173, open http://127.0.0.1:5173/?token=dev
npm test
npm run typecheck
```
