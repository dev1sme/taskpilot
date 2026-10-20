The plan for {{key}} is approved. Implement it now, following {{out.plan}}.
Read {{historyFile}} first: it records reviewer feedback and the decisions behind the plan.

- Keep {{out.progress}} up to date: a checklist of the plan's steps, with notes on blockers.
- Run the build and tests named in the plan. Fix failures, or write down why they cannot be fixed.
- When finished, write {{out.summary}}: what changed, files touched, build/test results,
  remaining work, notes for the reviewer.
- Append a `{{historyEntry}}` entry to {{historyFile}}: where you departed from the plan
  and why, open questions you settled on your own (and the choice you made).

Rules:
{{rules}}

End with a 3–6 line summary.
