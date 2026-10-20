## Context

The plan for task {{key}}: "{{title}}" is approved (step {{stepNumber}} of {{stepCount}}: {{step}}).

- Decision log: {{historyFile}}. Read it first: it records reviewer feedback and the decisions behind the plan.
- Documents of the earlier steps, to follow:
{{inputs}}

## Your job

Implement the plan in {{out.plan}}.

- Keep {{out.progress}} up to date while you work, one checklist line per step of the plan.
- Run the build and tests named in the plan. Fix failures, or write down why they cannot be fixed.

## Write

{{outputs}}

## Rules

{{rules}}

{{language}}

## When done

1. Append an entry to {{historyFile}}: where you departed from the plan and why, open questions you settled on your own (and the choice you made). Use this structure:

{{historyFormat}}

2. End your reply with a 3–6 line summary.
