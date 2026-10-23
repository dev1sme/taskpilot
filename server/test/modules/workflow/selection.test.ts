import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import { loadWorkflow } from "../../../src/modules/workflow/definition.js";
import { laneKey } from "../../../src/modules/workflow/execution.js";
import { readRepoSettings } from "../../../src/modules/workflow/settings.js";
import type { ExecutionSelection } from "../../../src/modules/workflow/types.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const close: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  for (const stop of close.splice(0)) await stop();
});
afterAll(cleanupTempDirs);

async function setup(env: Record<string, string> = {}) {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("selection-state-"));
  const log = path.join(repo, "rpc.jsonl");
  const context = { FAKE_CODEX_LOG: log, FAKE_CODEX_WORKFLOW: "1", ...env };
  const launchers = {
    codex: () => ({ file: process.execPath, args: [FAKE], env: context }),
    // These are only probed. A mistaken launch must fail without touching a real CLI.
    claude: () => ({ file: "/bin/bash", args: ["-c", "exit 99"] }),
    copilot: () => ({ file: "/bin/bash", args: ["-c", "exit 99"] }),
  };
  const sessions = new SessionManager(state, { launchers });
  close.push(() => sessions.closeAll());
  const load = async (r: string, mode?: string) => loadWorkflow(r, mode, (await readRepoSettings(r)).mode);
  let engine = new WorkflowEngine(state, sessions, load);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((e) => failures.push(e)));
  sessions.on("exit", (meta) => void engine.onExit(meta).catch((e) => failures.push(e)));
  const run = async () => (await state.load()).runs[0];
  const gate = async (index: number) => vi.waitFor(async () => expect(await run()).toMatchObject({ phase: "gate", stepIndex: index }));
  const records = async (): Promise<Array<{ method: string; params: { model?: string; input?: Array<{ text: string }> } }>> =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  const settings = async (text: string) => {
    await mkdir(path.join(repo, ".taskpilot"), { recursive: true });
    await writeFile(path.join(repo, ".taskpilot/settings.yml"), text);
  };
  const reload = () => (engine = new WorkflowEngine(state, sessions, load));
  return {
    repo,
    state,
    sessions,
    get engine() {
      return engine;
    },
    context,
    failures,
    run,
    gate,
    records,
    settings,
    reload,
    launchers,
  };
}

it.each(["default", "leader", "custom"])("applies Codex to every %s launch, preserving the YAML snapshot and default model", async (mode) => {
  const h = await setup({ FAKE_CODEX_TWO_MEMBERS: "1" });
  if (mode === "custom") {
    await h.settings("mode: custom\n");
    await writeFile(
      path.join(h.repo, ".taskpilot/workflow.yml"),
      "version: 2\nagent: claude\nmodel: opus\nsteps:\n  - id: one\n    prompt: one.md\n    outputs: [{ id: plan, file: 02-plan.md }]\n    done-when: plan\n    gate: approve\n  - id: two\n    agent: copilot\n    model: gpt-old\n    prompt: two.md\n    outputs: [{ id: result, file: 04-summary.md }]\n    done-when: result\n    gate: approve\n",
    );
    await writeFile(path.join(h.repo, ".taskpilot/one.md"), "WRITE:.claude/tasks/DEMO-1/02-plan.md {{agent}} {{outputs}}");
    await writeFile(path.join(h.repo, ".taskpilot/two.md"), "WRITE:.claude/tasks/DEMO-1/04-summary.md {{agent}} {{outputs}}");
  }
  const base = await loadWorkflow(h.repo, mode);
  const preview = await h.engine.preview(h.repo, "DEMO-1", { mode, execution: { agent: "codex" } });
  expect((await h.state.load()).sessions).toHaveLength(0);
  expect(preview.steps.every((s) => s.effective.agent === "codex" && s.effective.model === undefined)).toBe(true);
  expect(preview.steps[0].prompt).toMatch(/^## Chính sách thực thi TaskPilot/);
  const first = await h.engine.start(h.repo, "DEMO-1", { mode, execution: { agent: "codex" } });
  await h.gate(0);
  expect((await h.run()).workflow).toEqual(base);
  expect((await h.engine.view(h.repo, "DEMO-1")).workflow).toMatchObject({ outdated: false, steps: preview.steps.map((s) => ({ id: s.id, effective: s.effective })) });
  expect((await h.run()).sentPrompt?.text).toBe(preview.steps[0].prompt);
  // Changes to repo defaults must not influence dispatch, feedback or review of this run.
  await h.settings("mode: default\nexecutionVersion: 1\nexecution: { agent: copilot }\n");
  await h.engine.feedback(h.repo, "DEMO-1", "Review again");
  await h.gate(0);
  await h.engine.approve(h.repo, "DEMO-1");
  await h.gate(mode === "leader" ? 2 : 1);
  const run = await h.run();
  expect(run.sessionId).toBe(first.sessionId);
  if (mode === "leader")
    expect(run.subtasks?.map((s) => [s.agent, s.phase])).toEqual([
      ["codex", "done"],
      ["codex", "done"],
    ]);
  expect((await h.state.load()).sessions.every((s) => s.agent === "codex")).toBe(true);
  const records = await h.records();
  expect(records.filter((r) => r.method === "thread/start")).toHaveLength(mode === "leader" ? 3 : 1);
  expect(records.filter((r) => r.method.startsWith("thread/") || r.method === "turn/start").every((r) => r.params.model === undefined)).toBe(true);
  await h.engine.approve(h.repo, "DEMO-1");
  expect((await h.run()).phase).toBe("done");
  expect(h.failures).toEqual([]);
});

it("uses repo defaults only for new runs, lets an explicit workflow choice win, and never inherits the old model", async () => {
  const h = await setup();
  await h.settings("mode: leader\nexecution: { agent: codex, model: gpt-6.1-sol }\nexecutionVersion: 1\n");
  expect(await h.engine.preview(h.repo, "DEMO-1")).toMatchObject({ source: "repo", execution: { agent: "codex", model: "gpt-6.1-sol" } });
  const defaults = await h.engine.preview(h.repo, "DEMO-1", { execution: { agent: "codex" } });
  expect(defaults.execution).toEqual({ agent: "codex" });
  const workflow = await h.engine.preview(h.repo, "DEMO-1", { execution: { agent: "workflow" } });
  expect(workflow).toMatchObject({ source: "request", execution: { agent: "workflow" } });
  expect(workflow.steps[0].effective.agent).toBe("claude");
  await h.engine.start(h.repo, "DEMO-1", { mode: "default", execution: { agent: "codex", model: "gpt-6.1-sol" } });
  await h.gate(0);
  await h.engine.approve(h.repo, "DEMO-1");
  await h.gate(1);
  expect((await h.records()).filter((r) => r.method === "thread/start").map((r) => r.params.model)).toEqual(["gpt-6.1-sol"]);
});

it.each([
  ["claude", "taskpilot-implementer", "opus", ["agent", "model", "subagent"]],
  ["codex", "-", "gpt-6.1-sol", ["model"]],
])("blocks an incompatible assignment %s/%s/%s in preview and approve without rewriting it", async (agent, subagent, model, fields) => {
  const h = await setup();
  await h.engine.start(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex" } });
  await h.gate(0);
  const file = path.join(h.repo, ".claude/tasks/DEMO-1/02-plan.md");
  const table = `## 7. Phân công\n\n| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |\n|---|---|---|---|---|---|---|---|\n| 1 | A | ${agent} | ${subagent} | ${model} | server/ | report | - |\n`;
  await writeFile(file, table);
  const view = await h.engine.view(h.repo, "DEMO-1");
  expect(view.assignments?.items).toEqual([]);
  for (const field of fields as string[]) expect(view.assignments?.errors.join(";")).toContain(field);
  expect(view.assignments?.errors.join(";")).toContain("subtask 1:");
  await expect(h.engine.approve(h.repo, "DEMO-1")).rejects.toMatchObject({ status: 400 });
  expect(await readFile(file, "utf8")).toBe(table);
  expect((await h.run()).phase).toBe("gate");
  expect((await h.state.load()).sessions).toHaveLength(1);
});

it.each(["-", "default", "inherit"])("accepts %s in the table for a default policy without sending a model flag", async (cell) => {
  const h = await setup({ FAKE_CODEX_TABLE_MODEL: cell });
  await h.engine.start(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex" } });
  await h.gate(0);
  expect((await h.engine.view(h.repo, "DEMO-1")).assignments?.errors).toEqual([]);
  await h.engine.approve(h.repo, "DEMO-1");
  await h.gate(2);
  expect((await h.records()).filter((r) => r.method === "thread/start").map((r) => r.params.model)).toEqual([undefined, undefined]);
});

it("revalidates default Codex member retry after recovery and applies the pinned policy to dependent launches", async () => {
  const h = await setup({ FAKE_CODEX_TWO_MEMBERS: "1", FAKE_CODEX_HOLD_MEMBER: "1" });
  await h.engine.start(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex" } });
  await h.gate(0);
  await h.engine.approve(h.repo, "DEMO-1");
  await vi.waitFor(async () => expect((await h.sessions.get((await h.run()).subtasks![0].sessionId!)).activity).toBe("busy"));
  const sub = (await h.run()).subtasks![0];
  await h.sessions.stop(sub.sessionId!);
  await vi.waitFor(async () => expect((await h.run()).subtasks![0].phase).toBe("interrupted"));
  await h.settings("executionVersion: 1\nexecution: { agent: copilot }\n");
  h.reload();
  await h.engine.recover();
  h.context.FAKE_CODEX_LOGGED_OUT = "1";
  await expect(h.engine.retrySubtask(h.repo, "DEMO-1", 1)).rejects.toMatchObject({ code: "not_logged_in" });
  expect((await h.records()).filter((r) => r.method === "thread/resume")).toHaveLength(0);
  delete h.context.FAKE_CODEX_LOGGED_OUT;
  delete h.context.FAKE_CODEX_HOLD_MEMBER;
  await h.engine.retrySubtask(h.repo, "DEMO-1", 1);
  await h.gate(2);
  expect((await h.run()).subtasks?.map((s) => [s.agent, s.phase])).toEqual([
    ["codex", "done"],
    ["codex", "done"],
  ]);
  expect((await h.records()).filter((r) => r.method === "thread/start" || r.method === "thread/resume").every((r) => r.params.model === undefined)).toBe(true);
  expect(h.failures).toEqual([]);
});

it("checks main retry against its scoped exception after JSON reload without changing future steps", async () => {
  const h = await setup();
  await h.engine.start(h.repo, "DEMO-1", { execution: { agent: "codex" } });
  await h.gate(0);
  const run = await h.run();
  const scope = { kind: "step" as const, stepId: run.workflow!.steps[0].id };
  await h.state.update((s) => {
    s.runs[0] = {
      ...s.runs[0],
      phase: "interrupted",
      laneOverrides: { [laneKey(scope)]: { scope, execution: { agent: "codex", model: "gpt-6.1-sol" }, operationId: "test", at: Date.now() } },
    };
  });
  h.reload();
  await expect(h.engine.retry(h.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
  const persisted = (await new StateStore(h.state.dir).load()).runs[0];
  expect(persisted.laneOverrides).toEqual((await h.run()).laneOverrides);
  const view = await h.engine.view(h.repo, "DEMO-1");
  expect(view.workflow.steps.map((s) => s.model)).toEqual(["gpt-6.1-sol", undefined]);
});

it("preflights all steps before restart stops or archives anything, and blocks broken settings", async () => {
  const h = await setup();
  const first = await h.engine.start(h.repo, "DEMO-1", { execution: { agent: "codex" } });
  await h.gate(0);
  const plan = path.join(h.repo, ".claude/tasks/DEMO-1/02-plan.md");
  const before = await readFile(plan, "utf8");
  h.context.FAKE_CODEX_LOGGED_OUT = "1";
  await expect(h.engine.restart(h.repo, "DEMO-1", { execution: { agent: "codex" } })).rejects.toMatchObject({ code: "not_logged_in" });
  expect((await h.sessions.get(first.sessionId)).status).toBe("running");
  expect(await readFile(plan, "utf8")).toBe(before);
  expect((await h.run()).previous).toBeUndefined();
  delete h.context.FAKE_CODEX_LOGGED_OUT;
  await h.settings("executionVersion: 99\nexecution: { agent: codex }\n");
  await expect(h.engine.restart(h.repo, "DEMO-1", { execution: { agent: "codex" } })).rejects.toMatchObject({ name: "ExecutionValidationError" });
  expect((await h.sessions.get(first.sessionId)).status).toBe("running");
});

it("provides read-only task preview and validates start/restart API bodies with repo isolation", async () => {
  const h = await setup();
  const app = await buildApp({ token: "test", state: h.state, repo: h.repo, launchers: h.launchers, copilotQuota: async () => ({ ok: false, reason: "missing" }) });
  close.push(() => app.close());
  const headers = { host: "127.0.0.1:8790", "x-taskpilot-token": "test" };
  const post = (suffix: string, payload?: unknown) =>
    app.inject({ method: "POST", url: `/api/tasks/DEMO-1/run${suffix}`, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
  const execution: ExecutionSelection = { agent: "codex" };
  const before = await readFile(path.join(h.repo, ".claude/tasks/DEMO-1/02-plan.md"), "utf8");
  const preview = await post("/preview", { mode: "leader", execution });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({ source: "request", execution, errors: [] });
  expect((await h.state.load()).sessions).toHaveLength(0);
  expect((await h.state.load()).runs).toHaveLength(0);
  expect(await readFile(path.join(h.repo, ".claude/tasks/DEMO-1/02-plan.md"), "utf8")).toBe(before);
  for (const body of [{ execution: null }, { execution: { agent: "workflow", model: "opus" } }, { execution: { agent: "bad" } }, { mode: 5 }, { agent: "codex" }]) {
    expect((await post("/preview", body)).statusCode).toBe(400);
    expect((await post("", body)).statusCode).toBe(400);
    expect((await post("/restart", body)).statusCode).toBe(400);
  }
  await h.settings("execution: { agent: codex }\nexecutionVersion: 1\n");
  expect((await post("", { mode: "default" })).statusCode).toBe(200);
  expect((await h.run()).execution).toEqual(execution);
  // A different repo without settings still previews the built-in mixed configuration.
  const secondRepo = await makeRepo();
  expect((await h.engine.preview(secondRepo, "DEMO-1")).steps.map((s) => s.effective.agent)).toEqual(["claude", "copilot"]);
});

it("enforces an explicit model on every Leader member and keeps table defaults from inheriting it", async () => {
  const h = await setup({ FAKE_CODEX_TABLE_MODEL: "gpt-6.1-sol", FAKE_CODEX_TWO_MEMBERS: "1" });
  await h.engine.start(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex", model: "gpt-6.1-sol" } });
  await h.gate(0);
  const file = path.join(h.repo, ".claude/tasks/DEMO-1/02-plan.md");
  const correct = await readFile(file, "utf8");
  const incorrect = correct.replaceAll("| gpt-6.1-sol |", "| - |");
  await writeFile(file, incorrect);
  expect((await h.engine.view(h.repo, "DEMO-1")).assignments?.errors.join(";")).toContain("model: must be gpt-6.1-sol");
  await expect(h.engine.approve(h.repo, "DEMO-1")).rejects.toMatchObject({ status: 400 });
  expect(await readFile(file, "utf8")).toBe(incorrect);
  await writeFile(file, correct);
  await h.engine.approve(h.repo, "DEMO-1");
  await h.gate(2);
  expect((await h.records()).filter((r) => r.method === "thread/start").map((r) => r.params.model)).toEqual(["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol"]);
});

it("uses all restart request values and preserves valid extends overrides", async () => {
  const h = await setup();
  await h.settings("mode: default\nexecution: { agent: codex, model: gpt-6.1-sol }\nexecutionVersion: 1\n");
  await writeFile(path.join(h.repo, ".taskpilot/workflow.yml"), "extends: default\npermission-mode: acceptEdits\n");
  const first = await h.engine.start(h.repo, "DEMO-1");
  await h.gate(0);
  const restarted = await h.engine.restart(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex" } });
  await h.gate(0);
  expect(restarted.sessionId).not.toBe(first.sessionId);
  expect(restarted.execution).toEqual({ agent: "codex" });
  expect(restarted.workflow?.mode?.id).toBe("leader");
  expect(restarted.previous?.files).toContain("02-plan.md");
  expect((await h.records()).filter((r) => r.method === "thread/start").map((r) => r.params.model)).toEqual(["gpt-6.1-sol", undefined]);
});

it("rejects Codex plan without weakening permissions and checks later-step preflight before creating a session", async () => {
  const h = await setup();
  await h.settings("mode: default\n");
  await writeFile(path.join(h.repo, ".taskpilot/workflow.yml"), "extends: default\npermission-mode: plan\n");
  await expect(h.engine.preview(h.repo, "DEMO-1", { execution: { agent: "codex" } })).rejects.toMatchObject({ name: "ExecutionValidationError" });
  await expect(h.engine.start(h.repo, "DEMO-1", { execution: { agent: "codex" } })).rejects.toMatchObject({ name: "ExecutionValidationError" });
  expect((await h.state.load()).sessions).toHaveLength(0);
  const def = await loadWorkflow(await makeRepo());
  def.steps[1].agent = "codex";
  def.steps[1].model = "not-offered";
  const engine = new WorkflowEngine(h.state, h.sessions, async () => def);
  expect((await engine.preview(h.repo, "DEMO-1", { execution: { agent: "workflow" } })).errors).toMatchObject([{ stepId: def.steps[1].id, code: "model_unavailable" }]);
  await expect(engine.start(h.repo, "DEMO-1", { execution: { agent: "workflow" } })).rejects.toMatchObject({ code: "model_unavailable" });
  expect((await h.state.load()).sessions).toHaveLength(0);
  expect((await h.state.load()).runs).toHaveLength(0);
});

it("does not launch a persisted pending row that violates policy after recovery", async () => {
  const h = await setup({ FAKE_CODEX_TWO_MEMBERS: "1", FAKE_CODEX_HOLD_MEMBER: "1" });
  await h.engine.start(h.repo, "DEMO-1", { mode: "leader", execution: { agent: "codex" } });
  await h.gate(0);
  await h.engine.approve(h.repo, "DEMO-1");
  await vi.waitFor(async () => expect((await h.sessions.get((await h.run()).subtasks![0].sessionId!)).activity).toBe("busy"));
  const sub = (await h.run()).subtasks![0];
  await h.sessions.stop(sub.sessionId!);
  await vi.waitFor(async () => expect((await h.run()).subtasks![0].phase).toBe("interrupted"));
  await h.state.update((s) => {
    s.runs[0].subtasks![1].agent = "claude";
  });
  h.reload();
  await h.engine.recover();
  delete h.context.FAKE_CODEX_HOLD_MEMBER;
  await h.engine.retrySubtask(h.repo, "DEMO-1", 1);
  await vi.waitFor(() => expect(h.failures).toHaveLength(1));
  expect(h.failures[0]).toMatchObject({ status: 400, message: expect.stringContaining("subtask 2: agent: must be codex") });
  expect((await h.run()).subtasks![1]).toMatchObject({ agent: "claude", phase: "pending" });
  expect((await h.run()).subtasks![1].sessionId).toBeUndefined();
  expect((await h.state.load()).sessions.every((s) => s.agent === "codex")).toBe(true);
  expect((await h.run()).phase).toBe("interrupted");
  await expect(h.engine.retry(h.repo, "DEMO-1")).rejects.toMatchObject({ status: 400 });
  // After the persisted row is corrected, retry starts only pending member 2.
  await h.state.update((s) => {
    s.runs[0].subtasks![1].agent = "codex";
  });
  await h.engine.retry(h.repo, "DEMO-1");
  await h.gate(2);
  expect((await h.records()).filter((r) => r.method === "thread/start")).toHaveLength(3);
  expect((await h.run()).subtasks?.every((s) => s.phase === "done")).toBe(true);
});

it("retries an interrupted main session with its default model after a reload and repo-default change", async () => {
  const h = await setup();
  const def = await loadWorkflow(h.repo);
  def.steps[0].prompt = "SLOW {{agent}}";
  const engine = new WorkflowEngine(h.state, h.sessions, async () => def);
  const first = await engine.start(h.repo, "DEMO-1", { execution: { agent: "codex" } });
  await vi.waitFor(async () => expect((await h.sessions.get(first.sessionId)).activity).toBe("busy"));
  await h.sessions.stop(first.sessionId);
  await vi.waitFor(async () => expect((await h.run()).phase).toBe("interrupted"));
  await h.settings("executionVersion: 1\nexecution: { agent: copilot, model: gpt-other }\n");
  h.reload();
  await h.engine.recover();
  await h.engine.retry(h.repo, "DEMO-1");
  await vi.waitFor(async () => expect((await h.sessions.get(first.sessionId)).activity).toBe("busy"));
  expect((await h.records()).filter((r) => r.method === "thread/resume").map((r) => r.params.model)).toEqual([undefined]);
  const run = await h.run();
  expect(run.execution).toEqual({ agent: "codex" });
  expect(run.sessionId).toBe(first.sessionId);
  expect(run.sentPrompt?.text).toContain("SLOW Codex");
  expect(run.attempts?.[0]).toMatchObject({ execution: { modelSource: "default" }, actualModel: "gpt-6.1-sol" });
});
