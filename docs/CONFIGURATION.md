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

A repo uses TaskPilot's built-in workflow (`workflows/default/`) until it has an override in
`.claude/taskpilot/`. The *Workflow* page shows the workflow in use. The built-in one is read only
there; **Thêm config override** copies it (`workflow.yml` and its prompt files) into
`.claude/taskpilot/`, where every file can then be edited, checked, compared with the built-in
file and previewed as the exact prompt a task would get. **Xoá override** goes back to the
built-in workflow (every file is backed up first). TaskPilot only ever writes inside
`.claude/taskpilot/`, never `workflows/default/`. The old `.claude/workflow.yml` is no longer read.

The override is complete on its own: prompt files are looked up next to its `workflow.yml` only,
never in the built-in workflow.

```yaml
version: 2
permission-mode: acceptEdits        # optional: default | acceptEdits | plan | auto
history:
  file: 00-history.md               # the task's decision log
  entry: "## <YYYY-MM-DD HH:MM> · {{step}} · Claude"
language: Write the documents in the same language as the spec.
rules:                              # shared by every prompt through {{rules}}
  - "Append only to {{historyFile}}: add new entries at the end with Edit, never rewrite or remove earlier ones."
  - Do not push or merge.
restart:
  read: [plan, summary, progress]   # output ids a restarted run must read from the archive first
steps:
  - id: investigate
    title: Điều tra & lên kế hoạch
    prompt: investigate.md          # a file next to workflow.yml
    on-reject: revise-plan.md       # optional; without it the feedback is sent as it is
    outputs:                        # the documents this step writes in the task directory
      - id: investigation
        file: 01-investigation.md
        content: scope, related files (with paths), how that part works today, risks
      - id: plan
        file: 02-plan.md
        content: goal, changes per file, ordered steps, risks, how to verify, open questions
    done-when: plan                 # an output id of this step
    gate: approve                   # or none: continue without stopping
```

Prompt files are templates. Variables:

| Variable | Value |
|---|---|
| `{{key}}`, `{{title}}`, `{{step}}`, `{{stepNumber}}`, `{{stepCount}}` | the task and the step |
| `{{taskDir}}`, `{{specDir}}` | `.claude/tasks/<KEY>` and its `spec/` |
| `{{historyFile}}`, `{{historyEntry}}` | the decision log and the heading Claude uses in it |
| `{{outputs}}` | this step's documents with what each must contain |
| `{{inputs}}` | the documents of earlier steps |
| `{{out.<id>}}` | the path of one document, e.g. `{{out.plan}}` |
| `{{rules}}`, `{{language}}` | `rules` and `language` from `workflow.yml` |
| `{{previousRun}}`, `{{archiveDir}}` | after *Chạy lại từ đầu*: which archived documents to read first; empty otherwise |
| `{{feedback}}` | the reviewer's feedback, in `on-reject` prompts only |

A save is refused when it makes the workflow invalid (a `done-when` naming no output of its step,
a prompt file that does not exist, `{{out.x}}` for an unknown output, `{{feedback}}` outside an
`on-reject` prompt…). Unknown variables, unused prompt files and a first prompt without
`{{previousRun}}` are only warnings. A step counts as done only when its `done-when` file was
written after the step's prompt was sent; the task list reads how far a task got from the
declared outputs. A run keeps the workflow it started with: edits apply to new runs and to
*Chạy lại từ đầu*.
