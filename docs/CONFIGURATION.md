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
file and previewed as the prompt a step sends (for a sample task, `TASK-1`, optionally as after
*Chạy lại từ đầu* or with a sample feedback). **Xoá override** goes back to the built-in workflow
(every file is backed up first). TaskPilot only ever writes inside `.claude/taskpilot/`, never
`workflows/default/`. The old `.claude/workflow.yml` is no longer read. The page opens with a short
guide to all of this (*Override hoạt động thế nào*).

The override is complete on its own: prompt files are looked up next to its `workflow.yml` only,
never in the built-in workflow.

What an override changes, and when:

| File | Changing it changes |
|---|---|
| `workflow.yml` | the steps, the documents each step writes, the done-when file, gates, shared rules, the language sentence, the session's permission mode |
| step prompts (`investigate.md`, `implement.md`…) | the prompt pasted into Claude at the start of each step |
| on-reject prompts (`revise-*.md`) | the prompt sent with the reviewer's feedback (without one, the feedback is sent as it is) |
| skeletons (`format-*.md`) | the headings each document must keep; shown on the *Định dạng tài liệu* page (`#/formats`) |

- A run keeps the workflow it started with: edits apply to new runs and to *Chạy lại từ đầu*.
- The task list reads how far a task got from the declared document file names: renaming an
  output's `file`, or adding and removing steps, can make finished tasks look unfinished.
- An override does not follow later changes to the built-in workflow. Files that differ from it are
  tagged *đã sửa*; **So với mặc định** shows the diff and **Lấy lại bản mặc định** opens a draft
  with the built-in text, reviewed and saved like any edit.
- Commit `.claude/taskpilot/` to share the workflow with everyone who opens the repo.

```yaml
version: 2
permission-mode: acceptEdits        # optional: default | acceptEdits | plan | auto
history:
  file: 00-history.md               # the task's decision log
  entry: "## <YYYY-MM-DD HH:MM> · {{step}} · Claude"
  format: format-history.md         # skeleton of a whole entry ({{historyFormat}})
language: Viết tài liệu bằng cùng ngôn ngữ với spec.
rules:                              # shared by every prompt through {{rules}}
  - "Chỉ thêm entry mới vào cuối {{historyFile}} bằng Edit; không viết lại hay xoá entry cũ."
  - Không push, không merge.
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
        content: phạm vi, file liên quan (kèm đường dẫn), hiện trạng phần đó, rủi ro
      - id: plan
        file: 02-plan.md
        content: mục tiêu, thay đổi theo file, các bước theo thứ tự, rủi ro, cách verify, câu hỏi mở
        format: format-plan.md      # skeleton the document must follow (shown in {{outputs}})
    done-when: plan                 # an output id of this step
    gate: approve                   # or none: continue without stopping
```

Skeleton (`format`) files sit next to the prompts: the headings Claude must keep, in order, with a
`<!-- hint -->` per section; they may use the same variables (e.g. `# {{key}} — Kế hoạch`). The
built-in workflow ships one per document (`format-investigation.md`, `format-plan.md`,
`format-progress.md`, `format-summary.md`) and one for history entries (`format-history.md`), and
its prompts are written in Vietnamese and share one layout: *Bối cảnh*, *Việc cần làm*, *Tài liệu
cần viết*, *Quy tắc*, *Khi xong* (on-reject prompts start with *Góp ý* and only name the documents
to update: they already have their headings). A shared rule asks Claude to number its questions
for the reviewer, one per line with its proposal (`1. <câu hỏi> — Đề xuất: <…>`), and not to use
the `AskUserQuestion` tool: the task screen turns such lines into one answer field per question.

Prompt files are templates. Variables:

| Variable | Value |
|---|---|
| `{{key}}`, `{{title}}`, `{{step}}`, `{{stepNumber}}`, `{{stepCount}}` | the task and the step |
| `{{taskDir}}`, `{{specDir}}` | `.claude/tasks/<KEY>` and its `spec/` |
| `{{historyFile}}`, `{{historyEntry}}`, `{{historyFormat}}` | the decision log, the heading Claude uses in it, and the skeleton of a whole entry |
| `{{outputs}}` | this step's documents with what each must contain and, when it has a `format`, its skeleton in a code block (with one line on how to follow skeletons) |
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
