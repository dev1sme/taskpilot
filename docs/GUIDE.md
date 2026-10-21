# Using TaskPilot

## Tasks

```
<repo>/.claude/tasks/PROJ-123/
  spec/                  # you write the requirements here (any *.md, subfolders allowed)
  00-history.md          # decision log: start, your feedback, approvals, cancel, restarts
  01-investigation.md    # written by Claude
  02-plan.md
  03-progress.md
  04-summary.md
  archive/<stamp>/       # 01-04 from before a restart; Claude writes them again at the top
```

The first `# Heading` of the first spec file becomes the task title. `00-history.md` is one of the
task's documents like the others, but it doesn't count in the task list's "N Claude viết" total.

## Using it

1. Pick a task in the left column. Tasks that need you (waiting for review, for a permission
   prompt, or for an answer) are listed first with an amber band.
2. **Bắt đầu quy trình** opens a new Claude session and sends the investigate prompt. The screen
   shows the workflow as a stepper, what Claude is doing right now, and a live feed of every file
   read, command run and document written. The terminal stays folded at the bottom; it opens by
   itself when Claude asks for a permission. If Claude asks to trust the folder, answer there.
3. At a gate, the review card shows Claude's closing message and the document it wrote; **Duyệt**
   moves on, **Gửi góp ý** sends feedback and Claude revises in the same session. Claude's numbered
   questions (the plan's *Câu hỏi mở*, or its closing message) get one field each: keep its
   proposal, write another answer, or leave it. **Duyệt kèm trả lời** writes the answers into
   `00-history.md`, which the next step reads first; **Gửi góp ý** sends them back for a revision.
4. If Claude ends its turn without writing the expected file (for example it asked you a question),
   answer it on the card — question by question when it numbered them, or as free text; the answer
   is pasted into the session as if typed in the terminal. The terminal still works too.
   **Gửi lại bước** re-sends the step; if the session has exited it is resumed first
   (`claude --resume`, same session id).
5. **Chạy lại từ đầu** restarts the whole workflow in a new session at step 1, from any phase —
   running, interrupted, done or cancelled. A confirmation step warns that the current session
   stops (it's kept, not deleted; resume it from its tab) and that the task's `*.md` documents are
   copied to `archive/<stamp>/` before Claude writes them again. The new run's first prompt tells
   Claude which archived documents to read first, so it knows what was done before.

6. With the leader mode (**Cách chạy** next to *Bắt đầu*, or *Workflow* page → **Dùng làm mặc định của repo**; no override needed), the plan gate also
   shows the parsed **Phân công** table; **Duyệt** is disabled while it has errors. After approval the
   task screen shows a tree of subtasks, each with its agent, state and report. A subtask that is
   waiting has its own reply box, an interrupted one a **Gửi lại việc** button; their sessions are tabs in
   the terminal. When all are done, the leader reviews the reports.

**Prompt đã gửi** in the task toolbar shows the latest prompt TaskPilot pasted into the run's
session, exactly as Claude got it.

Every one of these events — start, your feedback and answers (quoted verbatim), approvals, cancel, restart — is
appended to `00-history.md`, and the built-in prompts read it before writing anything, so it stays
clear why a plan or implementation changed.

A task can have several sessions (tabs). **+ Session mới** opens a free session outside the workflow.
Sessions survive page reloads; after a TaskPilot restart they show as stopped and can be resumed.

## Repo terminal and Claude usage

The status bar at the bottom of every page has its own **Terminal**: a Claude session that isn't
tied to any task (reserved key `@repo`), for ad-hoc work in the repo. It behaves like a task's
session tabs — same drawer, opens itself on a permission prompt — but never shows up in a task's
session list, a workflow run or the activity feed.

The status bar also shows Claude's plan usage, e.g. `5h 42% · 7d 18%`, once a session's status line
has reported it (after its first response); the figure turns into a warning past 80%, and its
tooltip has the reset times. This is account-wide usage (Pro/Max plans or a spend-based gateway),
not just this repo's sessions.

With Copilot installed and logged in, a separate `Copilot 42%` item shows the share of the Copilot
account's budget used (AI credits, or premium requests on the legacy plans), read from Copilot when
a Copilot session is ready, while it works and when it ends a turn, at most once a minute. An
account without a limit of its own (e.g. Copilot Business on AI credits) shows `Copilot ∞`. It needs
the hooks TaskPilot installs, which Copilot loads only in a trusted folder: with
`permission-mode: auto` in the workflow, or after "Yes, and remember" at the trust question. When a
Copilot step gets no hook for a minute, the run says so; fix the trust and use "Gửi lại bước".
