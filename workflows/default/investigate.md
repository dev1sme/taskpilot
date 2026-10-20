You are working on task {{key}}: "{{title}}".
The requirements are in {{specDir}}/. Read every file there first.

{{previousRun}}

This step is investigation and planning only. Do not change source code.

1. If {{historyFile}} exists, read it first: it records reviewer feedback and earlier decisions.
   If {{taskDir}} already contains the documents below from an earlier run, read them and build on them.
2. Investigate the codebase: relevant files, flows, conventions, existing tests. Then write:
{{outputs}}
3. Append a `{{historyEntry}}` entry to {{historyFile}}: decisions taken,
   what changed since the previous plan (if any), open questions still waiting for the reviewer.
4. End with a 3–6 line summary of the plan and any questions for the reviewer.

Rules:
{{rules}}

{{language}}
