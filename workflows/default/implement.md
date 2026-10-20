The plan for {{key}} is approved. Implement it now, following {{taskDir}}/02-plan.md.
Read {{historyFile}} first: it records reviewer feedback and the decisions behind the plan.

- Keep {{taskDir}}/03-progress.md up to date: a checklist of the plan's steps, with notes on blockers.
- Run the build and tests named in the plan. Fix failures, or write down why they cannot be fixed.
- Do not push or merge.
- When finished, write {{taskDir}}/04-summary.md: what changed, files touched, build/test results,
  remaining work, notes for the reviewer.
- Append a `## <YYYY-MM-DD HH:MM> · {{step}} · Claude` entry to {{historyFile}}: where you departed from the plan
  and why, open questions you settled on your own (and the choice you made).
  Append only to {{historyFile}}: add new entries at the end with Edit, never rewrite or remove earlier ones.

End with a 3–6 line summary.
