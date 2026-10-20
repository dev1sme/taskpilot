import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_DIR, loadWorkflow } from "../../../src/modules/workflow/definition.js";
import { stageOf } from "../../../src/modules/workflow/stage.js";
import type { WorkflowDef } from "../../../src/modules/workflow/types.js";
import { promptVars, render, renderPrompt } from "../../../src/modules/workflow/vars.js";

const task = { key: "A-1", title: "Health" };

const def: WorkflowDef = {
  source: "/wf/workflow.yml",
  origin: "repo",
  dir: "/wf",
  history: { file: "log.md", entry: "### {{step}} · Claude" },
  language: "Viết bằng tiếng Việt.",
  rules: ["Only append to {{historyFile}}", "No push"],
  restart: { read: ["plan"] },
  steps: [
    {
      id: "plan",
      title: "Plan",
      prompt: "",
      promptFile: "p.md",
      outputs: [
        { id: "notes", file: "notes.md", content: "what you found" },
        { id: "plan", file: "plan.md", content: "the plan" },
      ],
      doneWhen: { output: "plan", file: "plan.md" },
      gate: "approve",
    },
    { id: "code", title: "Code", prompt: "", promptFile: "c.md", outputs: [{ id: "done", file: "done.md", content: "" }], gate: "none" },
  ],
};

describe("prompt variables", () => {
  it("renders known variables, {{out.id}}, and leaves unknown ones visible", () => {
    expect(render("{{key}} {{out.plan}} {{nope}}", { key: "A-1", "out.plan": "p.md" })).toBe("A-1 p.md {{nope}}");
  });

  it("builds outputs, inputs, rules and the history file from the workflow", () => {
    const vars = promptVars(def, 1, task);
    expect(vars).toMatchObject({
      step: "Code",
      stepNumber: "2",
      stepCount: "2",
      taskDir: ".claude/tasks/A-1",
      specDir: ".claude/tasks/A-1/spec",
      historyFile: ".claude/tasks/A-1/log.md",
      historyEntry: "### Code · Claude",
      "out.plan": ".claude/tasks/A-1/plan.md",
      outputs: "- `.claude/tasks/A-1/done.md`",
      inputs: "- `.claude/tasks/A-1/notes.md`: what you found\n- `.claude/tasks/A-1/plan.md`: the plan",
      rules: "- Only append to .claude/tasks/A-1/log.md\n- No push",
      language: "Viết bằng tiếng Việt.",
      archiveDir: "",
      previousRun: "",
    });
    expect(vars).not.toHaveProperty("feedback");
    expect(promptVars(def, 0, task, { feedback: "fix it" }).feedback).toBe("fix it");
  });

  it("tells a restarted run which archived documents to read", () => {
    const vars = promptVars(def, 0, task, { previous: { dir: "archive/20261020-150000", files: ["notes.md", "plan.md"] } });
    expect(vars.archiveDir).toBe(".claude/tasks/A-1/archive/20261020-150000");
    expect(vars.previousRun).toBe(
      [
        "This task was restarted from the first step. The previous run's documents were archived to",
        ".claude/tasks/A-1/archive/20261020-150000/ (notes.md, plan.md).",
        "Before anything else, read these to learn what was done before and why it was restarted:",
        "- .claude/tasks/A-1/archive/20261020-150000/plan.md",
        '- .claude/tasks/A-1/log.md (the latest "Chạy lại từ đầu" entry and the feedback before it)',
      ].join("\n"),
    );
    // Without restart.read every archived file is listed; listed ids that were not archived are skipped.
    const all = promptVars({ ...def, restart: undefined }, 0, task, { previous: { dir: "archive/x", files: ["notes.md"] } });
    expect(all.previousRun).toContain("- .claude/tasks/A-1/archive/x/notes.md\n");
    const none = promptVars(def, 0, task, { previous: { dir: "archive/x", files: [] } });
    expect(none.previousRun).toContain("had no documents to archive");
    expect(none.previousRun).not.toContain("archive/x");
  });

  it("shows an output's skeleton and the history entry's skeleton in a code block", () => {
    const withFormats: WorkflowDef = {
      ...def,
      history: { ...def.history, format: "h.md", formatText: "### {{step}}\n**Quyết định:**\n" },
      steps: [
        { ...def.steps[0], outputs: [{ id: "plan", file: "plan.md", content: "the plan", format: "f.md", formatText: "# {{key}} — Plan\n\n## Goal\n```sh\nnpm test\n```\n" }] },
        def.steps[1],
      ],
    };
    const vars = promptVars(withFormats, 0, task);
    expect(vars.outputs).toBe(
      [
        "- `.claude/tasks/A-1/plan.md`: the plan",
        "  Follow this structure: keep the headings in this order, fill every section, drop the <!-- --> hints.",
        "",
        "````markdown",
        "# A-1 — Plan",
        "",
        "## Goal",
        "```sh",
        "npm test",
        "```",
        "````",
      ].join("\n"),
    );
    expect(vars.historyFormat).toBe("```markdown\n### Plan\n**Quyết định:**\n```");
    // Without a skeleton, the entry heading alone.
    expect(promptVars(def, 0, task).historyFormat).toBe("```markdown\n### Plan · Claude\n```");
  });

  it("builds the built-in prompts from the workflow: sections, documents with skeletons, rules", async () => {
    const builtIn = await loadWorkflow(DEFAULT_WORKFLOW_DIR);
    const [investigate, implement] = builtIn.steps;
    const first = renderPrompt(investigate.prompt, promptVars(builtIn, 0, task));
    for (const heading of ["## Context", "## Your job", "## Write", "## Rules", "## When done"]) expect(first).toContain(heading);
    expect(first).toContain('You are working on task A-1: "Health" (step 1 of 2: Điều tra & lên kế hoạch).');
    expect(first).toContain("Do not change source code.");
    expect(first).toContain("- `.claude/tasks/A-1/02-plan.md`: goal, changes per file");
    expect(first).toContain("# A-1 — Kế hoạch\n\n## 1. Mục tiêu");
    expect(first).toContain("## 5. Cách verify");
    expect(first).toContain("# A-1 — Điều tra");
    expect(first).toContain("## <YYYY-MM-DD HH:MM> · Điều tra & lên kế hoạch · Claude\n\n**Quyết định:**");
    expect(first).toContain("- Append only to .claude/tasks/A-1/00-history.md: add new entries at the end with Edit");
    expect(first).toContain("Write the documents in the same language as the spec.");
    expect(first).not.toMatch(/\{\{/);
    expect(first).not.toMatch(/\n{3}/);

    const second = renderPrompt(implement.prompt, promptVars(builtIn, 1, task));
    expect(second).toContain("Implement the plan in .claude/tasks/A-1/02-plan.md.");
    expect(second).toContain("- `.claude/tasks/A-1/01-investigation.md`");
    expect(second).toContain("Keep .claude/tasks/A-1/03-progress.md up to date");
    expect(second).toContain("# A-1 — Tóm tắt");
    expect(second).toContain("- [ ] 1. <bước 1 của kế hoạch>");
    expect(second).toContain("- Do not push or merge.");
    expect(second).not.toMatch(/\{\{/);

    const reject = renderPrompt(investigate.onReject!, promptVars(builtIn, 0, task, { feedback: "More tests" }));
    expect(reject).toMatch(/^## Feedback\n\nReviewer feedback on the plan for task A-1: "Health":\n\nMore tests\n/);
    expect(reject).toContain("Update .claude/tasks/A-1/02-plan.md (and .claude/tasks/A-1/01-investigation.md if relevant)");
    expect(reject).not.toMatch(/\{\{/);
    const fix = renderPrompt(implement.onReject!, promptVars(builtIn, 1, task, { feedback: "Fix lint" }));
    expect(fix).toContain("rewrite .claude/tasks/A-1/04-summary.md so it describes the final state");
    expect(fix).not.toMatch(/\{\{/);
  });
});

describe("task stage", () => {
  it("counts steps up to the furthest one whose documents exist", () => {
    expect(stageOf(def, [])).toEqual({ done: 0, total: 2, step: null });
    expect(stageOf(def, ["notes.md"])).toEqual({ done: 0, total: 2, step: null });
    expect(stageOf(def, ["plan.md"])).toEqual({ done: 1, total: 2, step: "Plan" });
    // Without done-when, every output of the step must exist.
    expect(stageOf(def, ["done.md"])).toEqual({ done: 2, total: 2, step: "Code" });
  });
});
