# Configuring Claude and the workflow

## Claude configuration

The sidebar's *Cấu hình Claude* and *Tích hợp* sections show the repo's CLAUDE.md files, settings
and permissions, hooks, agents, commands, skills and MCP servers, merged across project, local and
user scopes. Everything can be edited: CLAUDE.md files, permission rules, hooks, agents, commands, skills and MCP
servers. Every save shows a diff first, refuses to overwrite a file that changed since you opened
it, and keeps a backup of the old version in `~/.taskpilot/backups/` (restore it from
*Lịch sử thay đổi*).

Agents, commands and skills get one tab per folder (`.claude/<kind>` project scope,
`~/.claude/<kind>` user scope); MCP servers get one tab per scope (`.mcp.json`, `~/.claude.json` for
this repo, `~/.claude.json`), the same way the CLAUDE.md page splits by scope. Adding a new one goes
into the open tab. An item shadowed by the same name in a higher-precedence scope is flagged —
Claude Code's own precedence: MCP local > project > user; agents project > user; skills and
commands user > project.

MCP secrets: for servers in the shared `.mcp.json`, mark a value as secret and TaskPilot writes
`${VAR}` in the file and keeps the value in its own env store (`~/.taskpilot/env.json`), passed to
the claude sessions it starts. Claude Code reads `${VAR}` from its process environment only, so
sessions you start yourself need the variable in your shell. Local and user servers are changed
through `claude mcp`; "Kiểm tra kết nối" asks `claude mcp get` and shows only the status. Secret values (env, headers, credentials in URLs)
are masked on the server and never sent to the browser; `${VAR}` references are shown, and MCP
servers whose variables are not set are flagged.

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

Prompt templates can use `{{key}}`, `{{title}}`, `{{step}}`, `{{taskDir}}`, `{{specDir}}`,
`{{historyFile}}` (the task's decision log, `<taskDir>/00-history.md`) and, in `on-reject` prompts,
`{{feedback}}`. A step counts as done only when its `done-when` file was written after the step's
prompt was sent.
