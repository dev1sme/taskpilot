import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import { parseWorkflowFiles } from "../../../src/modules/workflow/definition.js";
import { subagentProblems } from "../../../src/modules/workflow/run-checks.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const managers: SessionManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.closeAll();
});
afterAll(cleanupTempDirs);

it("runs a Codex leader, dispatches a Codex member, records tokens and completes feedback/gates", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-workflow-"));
  const sessions = new SessionManager(state, { launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
  managers.push(sessions);
  const files = new Map(
    Object.entries({
      "workflow.yml": `version: 2
agent: codex
permission-mode: acceptEdits
steps:
  - id: plan
    prompt: plan.md
    outputs: [{id: plan, file: 02-plan.md}]
    done-when: plan
    gate: approve
    on-reject: feedback.md
  - id: dispatch
    dispatch:
      from: plan
      prompt: member.md
      report: 03-viec-{{n}}.md
      parallel: 1
  - id: review
    prompt: review.md
    outputs: [{id: summary, file: 04-summary.md}]
    done-when: summary
    gate: approve
`,
      "plan.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md PLAN_TABLE {{outputs}}",
      "feedback.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md PLAN_TABLE {{feedback}}",
      "member.md": "WRITE:.claude/tasks/DEMO-1/03-viec-1.md {{subtask}}",
      "review.md": "WRITE:.claude/tasks/DEMO-1/04-summary.md {{outputs}}",
    }),
  );
  const { def, errors } = parseWorkflowFiles(files, { dir: repo, origin: "repo" });
  expect(errors).toEqual([]);
  const engine = new WorkflowEngine(state, sessions, async () => def!);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((e) => failures.push(e)));
  sessions.on("metrics", (meta, data) => void engine.onMetrics(meta, data).catch((e) => failures.push(e)));
  sessions.on("exit", (meta) => void engine.onExit(meta).catch((e) => failures.push(e)));
  const run = () => state.load().then((s) => s.runs[0]);
  await engine.start(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await run()).phase).toBe("gate"));
  await engine.feedback(repo, "DEMO-1", "Review again");
  await vi.waitFor(async () => expect((await run()).phase).toBe("gate"));
  await engine.approve(repo, "DEMO-1");
  await vi.waitFor(async () => expect(await run()).toMatchObject({ stepIndex: 2, phase: "gate" }));
  const sub = (await run()).subtasks?.[0];
  expect(sub).toMatchObject({ agent: "codex", phase: "done", metrics: { model: "gpt-6.1-sol", inputTokens: 100, outputTokens: 20 } });
  expect(await readFile(path.join(repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8")).toContain("100 token vào");
  await engine.approve(repo, "DEMO-1");
  expect((await run()).phase).toBe("done");
  expect(failures).toEqual([]);
});

it("rejects Codex plan mode in definitions and Codex subagents in assignment checks", async () => {
  const parsed = parseWorkflowFiles(
    new Map([
      ["workflow.yml", "version: 2\nagent: codex\npermission-mode: plan\nsteps:\n  - id: a\n    prompt: p.md\n"],
      ["p.md", "Do work"],
    ]),
    { dir: "/wf", origin: "repo" },
  );
  expect(parsed.def).toBeNull();
  expect(parsed.errors.join(" ")).toContain("Plan mode");
  expect(await subagentProblems("/repo", [{ n: 1, title: "Task", agent: "codex", subagent: "reviewer", files: ["server/"], output: "report", deps: [] }])).toHaveLength(1);
});

it.each(["RPC_FAIL", "FAIL_TURN", "SLOW"])("keeps a failed or interrupted %s turn waiting even without done-when", async (prompt) => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-failed-run-"));
  const sessions = new SessionManager(state, { launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
  managers.push(sessions);
  const def = parseWorkflowFiles(
    new Map([
      ["workflow.yml", "version: 2\nagent: codex\nsteps:\n  - id: run\n    prompt: p.md\n"],
      ["p.md", prompt],
    ]),
    { dir: repo, origin: "repo" },
  ).def!;
  const engine = new WorkflowEngine(state, sessions, async () => def);
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload));
  const run = await engine.start(repo, "DEMO-1");
  if (prompt === "SLOW") {
    await vi.waitFor(async () => expect((await sessions.get(run.sessionId)).activity).toBe("busy"));
    await sessions.interrupt(run.sessionId);
  }
  await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("waiting"));
});

it("preserves legacy Codex model switches when the run has no execution or attempt fields", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-legacy-switch-"));
  const sessions = new SessionManager(state, { launchers: { codex: () => ({ file: process.execPath, args: [FAKE] }) } });
  managers.push(sessions);
  const def = parseWorkflowFiles(
    new Map([
      [
        "workflow.yml",
        "version: 2\nagent: codex\nsteps:\n  - id: plan\n    model: gpt-6.1-sol\n    prompt: plan.md\n    gate: approve\n  - id: review\n    prompt: review.md\n    gate: approve\n",
      ],
      ["plan.md", "Plan {{agent}}"],
      ["review.md", "Review {{agent}}"],
    ]),
    { dir: repo, origin: "repo" },
  ).def!;
  const engine = new WorkflowEngine(state, sessions, async () => def);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((error) => failures.push(error)));
  const first = (await engine.start(repo, "DEMO-1")).sessionId;
  await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("gate"));
  await state.update((s) => {
    delete s.runs[0].execution;
    delete s.runs[0].executionSnapshot;
    delete s.runs[0].attempts;
  });
  await engine.approve(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await state.load()).runs[0]).toMatchObject({ phase: "gate", stepIndex: 1 }));
  expect((await state.load()).runs[0].sessionId).not.toBe(first);
  expect((await state.load()).sessions).toHaveLength(2);
  expect(failures).toEqual([]);
});
