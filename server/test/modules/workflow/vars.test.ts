import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_DIR, loadWorkflow, parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { stageOf } from "../../../src/modules/workflow/stage.js";
import type { WorkflowDef } from "../../../src/modules/workflow/types.js";
import { promptVars, render, renderPrompt } from "../../../src/modules/workflow/vars.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";

const LEADER_WORKFLOW_DIR = modeDir("leader");

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
        "Task này được chạy lại từ bước đầu. Tài liệu của lần chạy trước đã được lưu vào",
        ".claude/tasks/A-1/archive/20261020-150000/ (notes.md, plan.md).",
        "Trước tiên, đọc các file sau để biết lần trước đã làm gì và vì sao chạy lại:",
        "- .claude/tasks/A-1/archive/20261020-150000/plan.md",
        '- .claude/tasks/A-1/log.md (entry "Chạy lại từ đầu" mới nhất và góp ý ngay trước nó)',
      ].join("\n"),
    );
    // Without restart.read every archived file is listed; listed ids that were not archived are skipped.
    const all = promptVars({ ...def, restart: undefined }, 0, task, { previous: { dir: "archive/x", files: ["notes.md"] } });
    expect(all.previousRun).toContain("- .claude/tasks/A-1/archive/x/notes.md\n");
    const none = promptVars(def, 0, task, { previous: { dir: "archive/x", files: [] } });
    expect(none.previousRun).toContain("lần chạy trước chưa có tài liệu nào để lưu");
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
        "Tài liệu có khung: giữ heading đúng thứ tự, điền mọi mục, bỏ gợi ý <!-- -->.",
        "",
        "- `.claude/tasks/A-1/plan.md`: the plan",
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

  describe("subtasks", () => {
    const dispatchDef = (parallel: number): WorkflowDef => ({
      ...def,
      steps: [
        def.steps[0],
        {
          id: "work",
          title: "Giao việc",
          agent: "claude",
          prompt: "",
          promptFile: "",
          outputs: [],
          gate: "none",
          dispatch: { from: "plan", prompt: "", promptFile: "s.md", report: "03-viec-{{n}}.md", format: "f.md", formatText: "# {{key}} — Việc", parallel },
        },
        def.steps[1],
      ],
    });
    const subs = [
      { n: 1, title: "Parser", agent: "claude" as const, files: ["server/a.ts"], output: "parser", deps: [] },
      { n: 2, title: "UI", agent: "copilot" as const, files: [], output: "", deps: [1] },
    ];

    it("describes the subtask, its dependencies' reports and its own report with the skeleton", () => {
      const vars = promptVars(dispatchDef(1), 1, task, { subtask: subs[1], subtasks: subs });
      expect(vars.agent).toBe("Copilot");
      expect(vars.subtaskReport).toBe(".claude/tasks/A-1/03-viec-2.md");
      expect(vars.subtask).toBe(
        [
          "Việc 2: UI",
          "File được sửa: leader không khai; chỉ sửa những gì việc này cần.",
          "",
          "Các việc trước đó đã xong; đọc báo cáo của chúng trước khi làm:",
          "- `.claude/tasks/A-1/03-viec-1.md` (việc 1: Parser)",
        ].join("\n"),
      );
      expect(vars.outputs).toContain("- `.claude/tasks/A-1/03-viec-2.md`: báo cáo việc này");
      expect(vars.outputs).toContain("# A-1 — Việc");
      expect(vars.inputs).toContain(".claude/tasks/A-1/plan.md");
    });

    it("tells members not to commit only when subtasks run in parallel", () => {
      expect(promptVars(dispatchDef(1), 1, task, { subtask: subs[0], subtasks: subs }).subtask).not.toContain("Không commit");
      const parallel = promptVars(dispatchDef(2), 1, task, { subtask: subs[0], subtasks: subs }).subtask;
      expect(parallel).toContain("File được sửa: `server/a.ts`");
      expect(parallel).toContain("Đầu ra mong đợi: parser");
      expect(parallel).toContain("Không commit");
    });

    it("names the subagent and model of a subtask in its prompt and in the review list", () => {
      const withRunner = [{ ...subs[0], subagent: "taskpilot-implementer", model: "haiku" }, { ...subs[1], model: "gpt-5" }];
      expect(promptVars(dispatchDef(1), 1, task, { subtask: withRunner[0], subtasks: withRunner }).subtask).toBe(
        ["Việc 1: Parser", "Đầu ra mong đợi: parser", "Chạy bằng subagent `taskpilot-implementer`, model `haiku`.", "File được sửa: `server/a.ts`"].join("\n"),
      );
      expect(promptVars(dispatchDef(1), 1, task, { subtask: withRunner[1], subtasks: withRunner }).subtask).toContain("Chạy bằng model `gpt-5`.");
      expect(promptVars(dispatchDef(1), 1, task, { subtask: subs[0], subtasks: subs }).subtask).not.toContain("Chạy bằng");
      expect(promptVars(dispatchDef(1), 2, task, { subtasks: withRunner }).subtasks).toBe(
        "- Việc 1 · Claude · taskpilot-implementer · haiku · Parser → `.claude/tasks/A-1/03-viec-1.md`\n- Việc 2 · Copilot · gpt-5 · UI → `.claude/tasks/A-1/03-viec-2.md`",
      );
    });

    it("adds each done subtask's numbers to the review list", () => {
      const measured = [
        { ...subs[0], metrics: { model: "claude-haiku-4-5", costUsd: 0.4213, durationMs: 725_000 } },
        { ...subs[1], metrics: { model: "gpt-5", durationMs: 40_000 } },
      ];
      expect(promptVars(dispatchDef(1), 2, task, { subtasks: measured }).subtasks).toBe(
        [
          "- Việc 1 · Claude · Parser → `.claude/tasks/A-1/03-viec-1.md` · model `claude-haiku-4-5` · 12 phút 5 giây · $0.42",
          "- Việc 2 · Copilot · UI → `.claude/tasks/A-1/03-viec-2.md` · model `gpt-5` · 40 giây · chi phí không có",
        ].join("\n"),
      );
    });

    it("lists every subtask for the review step, and nothing outside a run", () => {
      expect(promptVars(dispatchDef(1), 2, task, { subtasks: subs }).subtasks).toBe(
        "- Việc 1 · Claude · Parser → `.claude/tasks/A-1/03-viec-1.md`\n- Việc 2 · Copilot · UI → `.claude/tasks/A-1/03-viec-2.md`",
      );
      expect(promptVars(dispatchDef(1), 2, task).subtasks).toBe("");
    });
  });

  it("builds the built-in prompts from the workflow: sections, documents with skeletons, rules", async () => {
    const builtIn = await loadWorkflow(DEFAULT_WORKFLOW_DIR);
    const [investigate, implement] = builtIn.steps;
    const first = renderPrompt(investigate.prompt, promptVars(builtIn, 0, task));
    for (const heading of ["## Bối cảnh", "## Việc cần làm", "## Tài liệu cần viết", "## Quy tắc", "## Khi xong"]) expect(first).toContain(heading);
    expect(first).toContain('Bạn đang làm task A-1: "Health" (bước 1/2: Điều tra & lên kế hoạch).');
    expect(first).toContain("Không sửa source code.");
    expect(first).toContain("- `.claude/tasks/A-1/02-plan.md`: mục tiêu, thay đổi theo file");
    expect(first).toContain("# A-1 — Kế hoạch\n\n## 1. Mục tiêu");
    expect(first).toContain("## 5. Cách verify");
    expect(first).toContain("# A-1 — Điều tra");
    expect(first).toContain("## <YYYY-MM-DD HH:MM> · Điều tra & lên kế hoạch · Claude\n\n**Quyết định:**");
    expect(first).toContain("- Chỉ thêm entry mới vào cuối .claude/tasks/A-1/00-history.md bằng Edit");
    expect(first).toContain("Không dùng tool AskUserQuestion");
    expect(first).toContain("Viết tài liệu bằng cùng ngôn ngữ với spec.");
    // The skeleton rule is said once, not once per document.
    expect(first.split("Tài liệu có khung").length).toBe(2);
    expect(first).not.toMatch(/\{\{/);
    expect(first).not.toMatch(/\n{3}/);

    const second = renderPrompt(implement.prompt, promptVars(builtIn, 1, task));
    expect(second).toContain("Thực hiện kế hoạch trong .claude/tasks/A-1/02-plan.md.");
    expect(second).toContain("(bước 2/2: Triển khai)");
    expect(second).toContain("- `.claude/tasks/A-1/01-investigation.md`");
    expect(second).toContain("Cập nhật .claude/tasks/A-1/03-progress.md trong lúc làm");
    expect(second).toContain("# A-1 — Tóm tắt");
    expect(second).toContain("- [ ] 1. <bước 1 của kế hoạch>");
    expect(second).toContain("- Không push, không merge.");
    expect(second).not.toMatch(/\{\{/);

    const reject = renderPrompt(investigate.onReject!, promptVars(builtIn, 0, task, { feedback: "More tests" }));
    expect(reject).toMatch(/^## Góp ý\n\nGóp ý của reviewer cho kế hoạch của task A-1: "Health":\n\nMore tests\n/);
    expect(reject).toContain("Cập nhật .claude/tasks/A-1/02-plan.md (và .claude/tasks/A-1/01-investigation.md nếu liên quan)");
    expect(reject).not.toMatch(/\{\{/);
    const fix = renderPrompt(implement.onReject!, promptVars(builtIn, 1, task, { feedback: "Fix lint" }));
    expect(fix).toContain("viết lại .claude/tasks/A-1/04-summary.md để mô tả trạng thái cuối cùng");
    expect(fix).not.toMatch(/\{\{/);

    // No English sentences left from the old prompts.
    for (const text of [first, second, reject, fix]) {
      expect(text).not.toMatch(/Your job|When done|Follow this structure|Do not|Read them all|Append only/);
    }
  });

  it("keeps the built-in prompts within their size budget; on-reject prompts carry no skeletons", async () => {
    const builtIn = await loadWorkflow(DEFAULT_WORKFLOW_DIR);
    const sizes = builtIn.steps.map((s, i) => ({
      prompt: renderPrompt(s.prompt, promptVars(builtIn, i, { key: "TPL-008", title: "Prompt mặc định" })),
      onReject: renderPrompt(s.onReject!, promptVars(builtIn, i, { key: "TPL-008", title: "Prompt mặc định" }, { feedback: "x" })),
    }));
    // Budgets from TPL-008: main prompts no longer than the English ones were, on-reject prompts ≤ 1500 characters.
    expect(sizes[0].prompt.length).toBeLessThanOrEqual(2809);
    expect(sizes[1].prompt.length).toBeLessThanOrEqual(2730);
    for (const { onReject } of sizes) {
      expect(onReject.length).toBeLessThanOrEqual(1500);
      expect(onReject).not.toContain("```markdown\n# TPL-008");
    }
  });
});

describe("leader template prompts", () => {
  const vars = { key: "TPL-011", title: "Leader điều phối động" };
  const subs = [
    { n: 1, title: "Parser", agent: "claude" as const, files: ["server/a.ts"], output: "parser", deps: [] },
    { n: 2, title: "UI", agent: "copilot" as const, files: ["client"], output: "UI", deps: [1] },
  ];

  it("renders every prompt with no variable left and keeps to its size budget", async () => {
    const { def } = parseWorkflowFiles(await readWorkflowDir(LEADER_WORKFLOW_DIR), { dir: LEADER_WORKFLOW_DIR, origin: "default" });
    const leader = def!;
    const render = (i: number, template: string, extra: Parameters<typeof promptVars>[3] = {}) => renderPrompt(template, promptVars(leader, i, vars, extra));
    const plan = render(0, leader.steps[0].prompt);
    const subtask = render(1, leader.steps[1].dispatch!.prompt, { subtask: subs[1], subtasks: subs });
    const review = render(2, leader.steps[2].prompt, { subtasks: subs });
    const reviseReview = render(2, leader.steps[2].onReject!, { subtasks: subs, feedback: "x" });
    for (const text of [plan, subtask, review, reviseReview]) expect(text).not.toMatch(/\{\{/);
    expect(plan).toContain("## 7. Phân công");
    expect(plan).toContain("| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |");
    expect(plan).toContain("Chưa có subagent nào dùng được");
    expect(subtask).toContain("Việc 2: UI");
    expect(subtask).toContain("- `.claude/tasks/TPL-011/03-viec-1.md` (việc 1: Parser)");
    expect(subtask).toContain("# TPL-011 — Báo cáo việc");
    expect(review).toContain("- Việc 2 · Copilot · UI → `.claude/tasks/TPL-011/03-viec-2.md`");
    expect(review).toContain("Đánh giá subagent / model của từng việc");
    expect(review).toContain("## Đánh giá subagent / model\n<!-- Bảng: | Việc | Subagent | Model | Thời gian | Chi phí | Nhận xét | Lần sau |");
    // Without subagents; each one the repo has adds a line of {{subagents}}.
    expect(plan.length).toBeLessThanOrEqual(4600);
    expect(subtask.length).toBeLessThanOrEqual(2000);
    expect(review.length).toBeLessThanOrEqual(2900);
    expect(reviseReview.length).toBeLessThanOrEqual(1500);
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
