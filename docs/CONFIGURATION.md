# Configuring Claude, Copilot and the workflow

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

## Agents: Claude and Copilot

A session runs one coding agent: Claude Code (`claude`, the default) or GitHub Copilot CLI
(`copilot`). The **+** of a terminal asks which one. In a workflow, `agent` at the top sets the
agent of every step and a step's own `agent` overrides it, so one task can have Claude investigate
and plan, then Copilot implement the approved plan (Claude as leader, Copilot as member):

```yaml
version: 2
agent: claude                 # default of every step; claude when absent
steps:
  - id: investigate
    # …runs with claude
  - id: implement
    agent: copilot            # this step runs with Copilot
    # …
```

When a step's agent differs from the previous step's, the run stops the previous session (it stays
listed), starts a new session of the step's agent and logs the switch in the decision log. The new
agent knows the task from its documents and the decision log, which every built-in prompt has it
read first; `{{agent}}` names the step's agent (the built-in history heading uses it). Restarting
starts over with the first step's agent. The built-in workflow investigates and plans with Claude and implements with Copilot (which needs
`permission-mode: auto`, see below; the built-in has none).

`permission-mode` maps to Copilot flags:

| `permission-mode` | Copilot |
|---|---|
| `default` / absent | no flag: Copilot asks before writes and commands |
| `acceptEdits` | `--allow-tool=write` |
| `plan` | `--mode plan` |
| `auto` | env `COPILOT_ALLOW_ALL=true`: allows every tool and **trusts the folder without asking**, so the repo's hooks (and MCP servers, skills, plugins) load. Not `--yolo`/`--allow-all-paths`/`--allow-all-urls`. |

A Copilot step needs `permission-mode: auto` to run unattended: set it in the repo's override
(`.taskpilot/`), since the built-in workflow has none. It also becomes Claude's
`--permission-mode auto`. In the other modes Copilot loads the repo's hooks only once you trust
the folder **permanently** (option 2, "Yes, and remember"; "this session" does not reliably load
them). Without hooks TaskPilot never hears that Copilot finished: the run says so after a minute
without any hook (use "Gửi lại bước" after fixing the trust) and the footer has no Copilot usage.

How TaskPilot drives Copilot (copilot 1.0.100, see
[hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) and
[config directory reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)):

- Copilot has no `--settings` flag, so TaskPilot writes its seven hooks into the repo's
  `.github/copilot/settings.local.json` before every Copilot session, under Claude's event names
  (`SessionStart`, `Stop`…): with those names Copilot sends Claude-style payloads. Only entries that
  post to `$TASKPILOT_HOOK_URL` are TaskPilot's; your keys and hooks in the file are kept (comments
  are dropped when the file is rewritten, which happens only when TaskPilot's entries change). The
  hooks do nothing in a `copilot` you start yourself. The file is not added to `.gitignore`: do it
  if the repo should not share it.
- Without `permission-mode: auto`, Copilot asks whether you trust the folder on its first start in a
  repo (or every start, if you trust it for the session only). Answer in the terminal; the step's prompt is sent once Copilot's
  input box is ready, never into that question.
- Copilot also runs the hooks in the repo's `.claude/settings.json` and `.claude/settings.local.json`.
- The footer's plan usage is Claude's only: Copilot's status line input has no account quota.

## Custom workflow

### Modes (how a task runs)

TaskPilot ships its workflows as **modes**: one directory `workflows/<id>/workflow.yml` each
(`default`: static steps; `leader`: Claude leads, members do the plan's rows). No override is
needed to pick one:

- the *Workflow* page has a tab per mode and **Dùng làm mặc định của repo**; the choice is written to
  `.taskpilot/settings.yml` in the repo (`mode: <id>`; backed up first, kept by *Xoá override*);
- the task screen has a **Cách chạy** select next to *Bắt đầu* / *Chạy lại từ đầu* (hidden while
  only one mode is available) to run one task differently;
- a run keeps the mode it started with (snapshot, `workflow.mode`) and the history entry names it.

Adding a mode = adding a `workflows/<id>/workflow.yml` (with a `name` and `description`).

### Override

A repo's override in `.taskpilot/` is `workflow.yml` with `extends: <mode>` and only what
differs from that mode: top-level keys (`agent`, `permission-mode`, `language`, `rules`, `history`,
`restart`) replace the mode's; a step with an id of the mode patches that step (only the keys
written: `title`, `dispatch.prompt|format|parallel`); a new step is added with exactly one of
`before` / `after`; a prompt or format file of the directory replaces the mode's file of the same
name. Everything not written follows the mode, so it gets TaskPilot's updates. An override applies
only to the mode it extends; for other modes the page says *không áp dụng* and shows the built-in.

The *Workflow* page shows the mode in use, read only. **Tạo override dựa trên <mode>** writes just
`workflow.yml` (refused with 409 if files already in `.taskpilot/` clash with the mode's file
names). Files can then be edited, checked, compared with the built-in file and previewed as the
prompt a step sends (for a sample task, `TASK-1`, optionally as after *Chạy lại từ đầu* or with a
sample feedback). **Xoá override** goes back to the built-in workflow (every file is backed up
first). TaskPilot only ever writes inside `.taskpilot/`, never `workflows/`. The old
`.claude/workflow.yml` is no longer read. The page opens with a short guide (*Override hoạt động
thế nào*). The Formats page shows each document's skeleton from the workflow as it runs, and
offers *Sửa* only for skeletons the override holds.

**Complete (legacy) overrides.** An override without `extends` (a full copy) still works, as the
special mode `custom`, the repo's default while it exists; a new one cannot be created. A banner
offers **Chuyển sang dạng extends**: a diff of the new `workflow.yml` is reviewed first, files equal
to the base mode's are dropped, and everything is backed up. The regenerated `workflow.yml` does not keep the
original comments (the backup does). `POST /api/config/workflow/override/migrate`.

What an override changes, and when:

| File | Changing it changes |
|---|---|
| `workflow.yml` | the steps, the documents each step writes, the done-when file, gates, shared rules, the language sentence, the session's permission mode, the agent of each step |
| step prompts (`investigate.md`, `implement.md`…) | the prompt pasted into Claude at the start of each step |
| on-reject prompts (`revise-*.md`) | the prompt sent with the reviewer's feedback (without one, the feedback is sent as it is) |
| skeletons (`format-*.md`) | the headings each document must keep; shown on the *Định dạng tài liệu* page (`#/formats`) |

- A run keeps the workflow it started with: edits apply to new runs and to *Chạy lại từ đầu*.
- The task list reads how far a task got from the declared document file names: renaming an
  output's `file`, or adding and removing steps, can make finished tasks look unfinished.
- An `extends` override follows later changes to the mode for everything it does not write. Files
  it holds are tagged *thay file có sẵn* / *file thêm*; **So với mặc định** shows the diff and
  **Lấy lại bản mặc định** opens a draft with the built-in text, reviewed and saved like any edit.
- Commit `.taskpilot/` to share the workflow with everyone who opens the repo.

```yaml
version: 2
agent: claude                       # optional: claude | copilot; a step's `agent` overrides it
permission-mode: acceptEdits        # optional: default | acceptEdits | plan | auto
history:
  file: 00-history.md               # the task's decision log
  entry: "## <YYYY-MM-DD HH:MM> · {{step}} · {{agent}}"
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
| `{{agent}}` | the agent that runs the step: `Claude` or `Copilot` |
| `{{taskDir}}`, `{{specDir}}` | `.claude/tasks/<KEY>` and its `spec/` |
| `{{historyFile}}`, `{{historyEntry}}`, `{{historyFormat}}` | the decision log, the heading Claude uses in it, and the skeleton of a whole entry |
| `{{outputs}}` | this step's documents with what each must contain and, when it has a `format`, its skeleton in a code block (with one line on how to follow skeletons) |
| `{{inputs}}` | the documents of earlier steps |
| `{{out.<id>}}` | the path of one document, e.g. `{{out.plan}}` |
| `{{rules}}`, `{{language}}` | `rules` and `language` from `workflow.yml` |
| `{{previousRun}}`, `{{archiveDir}}` | after *Chạy lại từ đầu*: which archived documents to read first; empty otherwise |
| `{{feedback}}` | the reviewer's feedback, in `on-reject` prompts only |
| `{{subtask}}`, `{{subtaskReport}}` | in a dispatch step's prompt: the subtask (row of the plan's table, its dependencies and parallel peers) and the path of its report; `{{agent}}` is the subtask's agent |
| `{{subtasks}}` | in the steps after a dispatch: the subtasks with their agents and report paths |

A save is refused when it makes the workflow invalid (a `done-when` naming no output of its step,
a prompt file that does not exist, `{{out.x}}` for an unknown output, `{{feedback}}` outside an
`on-reject` prompt…). Unknown variables, unused prompt files and a first prompt without
`{{previousRun}}` are only warnings. A step counts as done only when its `done-when` file was
written after the step's prompt was sent; the task list reads how far a task got from the
declared outputs. A run keeps the workflow it started with: edits apply to new runs and to
*Chạy lại từ đầu*.

## Leader / member workflow

`workflows/leader/` is a mode: Claude (the leader) investigates and writes a plan ending
with a `## 7. Phân công` table, the reviewer approves, then every row runs in its own session of the
agent it names (`claude` or `copilot`), and the leader's session reviews the reports. Pick it
without an override: **Cách chạy** on the task screen, or **Dùng làm mặc định của repo** on the
*Workflow* page. An override can still `extends: leader`.

```yaml
steps:
  - id: investigate            # ... outputs, done-when: plan, gate: approve  (required before dispatch)
  - id: dispatch
    title: Giao việc
    dispatch:
      from: plan               # output id of an earlier step holding the table
      prompt: subtask.md       # sent to each subtask's session ({{subtask}}, {{subtaskReport}})
      report: 03-viec-{{n}}.md # report each subtask writes; {{n}} = its number
      format: format-subtask.md  # optional skeleton of the report
      parallel: 1              # 1-4 subtasks at once
  - id: review
    prompt: review.md          # reads {{subtasks}}
```

The table columns are `# | Việc | Agent | File | Đầu ra | Phụ thuộc`. `File` lists the files or
directories a subtask edits (comma separated); `Phụ thuộc` lists the numbers that must finish first
(`-` for none). With `parallel` above 1, subtasks start together only when their dependencies are done
and their `File` cells do not overlap. A save is refused when the step before a `dispatch` is not
`gate: approve`, when `from` names no output, when there is a second `dispatch` step or no step after it, when `report` lacks `{{n}}` or collides with an output file, or when `parallel` is outside 1–4. A `dispatch` step has
no `prompt`, `outputs`, `done-when` or `gate` of its own.
