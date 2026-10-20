You are working on task {{key}}: "{{title}}".
The requirements are in {{specDir}}/. Read every file there first.

This step is investigation and planning only. Do not change source code.

1. If {{historyFile}} exists, read it first: it records reviewer feedback and earlier decisions.
   If {{taskDir}} already contains 01-investigation.md or 02-plan.md from an earlier run, read them and build on them.
2. Investigate the codebase: relevant files, flows, conventions, existing tests.
   Write the findings to {{taskDir}}/01-investigation.md: scope, related files (with paths),
   how that part works today, risks.
3. Write the plan to {{taskDir}}/02-plan.md: goal, changes per file, ordered steps, risks,
   how to verify (exact build/test commands), open questions.
4. Append a `## <YYYY-MM-DD HH:MM> · {{step}} · Claude` entry to {{historyFile}}: decisions taken,
   what changed since the previous plan (if any), open questions still waiting for the reviewer.
   Append only to {{historyFile}}: add new entries at the end with Edit, never rewrite or remove earlier ones.
5. End with a 3–6 line summary of the plan and any questions for the reviewer.

Write the documents in the same language as the spec.
