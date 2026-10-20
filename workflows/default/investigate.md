## Context

You are working on task {{key}}: "{{title}}" (step {{stepNumber}} of {{stepCount}}: {{step}}).

- Requirements: every file in {{specDir}}/. Read them all first.
- Decision log: {{historyFile}}. If it exists, read it before anything else: it records reviewer feedback and earlier decisions.
- If the documents listed under "Write" already exist from an earlier run, read them and build on them.

{{previousRun}}

## Your job

Investigation and planning only. Do not change source code.

Investigate the codebase: relevant files, flows, conventions, existing tests. Then write the documents below.

## Write

{{outputs}}

## Rules

{{rules}}

{{language}}

## When done

1. Append an entry to {{historyFile}}: decisions taken, what changed since the previous plan (if any), open questions still waiting for the reviewer. Use this structure:

{{historyFormat}}

2. End your reply with a 3–6 line summary of the plan and any questions for the reviewer.
