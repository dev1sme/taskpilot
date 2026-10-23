import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import {
  assignmentExecutionProblems,
  executionOfRun,
  ExecutionValidationError,
  laneKey,
  parseExecution,
  resolveExecution,
  selectExecution,
  snapshotExecution,
} from "../../../src/modules/workflow/execution.js";
import { parseRepoSettings, patchRepoSettings, readRepoSettings, settingsText } from "../../../src/modules/workflow/settings.js";
import type { Assignment, ExecutionSelection, LaneOverride, LaneScope, RunState, WorkflowDef } from "../../../src/modules/workflow/types.js";

const workflow = (): WorkflowDef => ({
  source: "/workflows/leader/workflow.yml",
  origin: "default",
  dir: "/workflows/leader",
  agent: "claude",
  model: "sonnet",
  permissionMode: "acceptEdits",
  history: { file: "00-history.md", entry: "Decision" },
  language: "English",
  rules: [],
  steps: [
    { id: "investigate", title: "Plan", agent: "claude", model: "opus", prompt: "plan", promptFile: "plan.md", outputs: [], gate: "approve" },
    {
      id: "dispatch",
      title: "Dispatch",
      agent: "claude",
      prompt: "",
      promptFile: "",
      outputs: [],
      gate: "none",
      dispatch: { from: "plan", prompt: "work", promptFile: "work.md", report: "03-{{n}}.md", parallel: 1 },
    },
    { id: "review", title: "Review", agent: "copilot", model: "review-model", prompt: "review", promptFile: "review.md", outputs: [], gate: "approve" },
  ],
});
const assignment = (extra: Partial<Assignment> = {}): Assignment => ({ n: 1, title: "Work", agent: "claude", model: "sonnet", files: ["src"], output: "report", deps: [], ...extra });
const main: LaneScope = { kind: "step", stepId: "investigate" };
const member: LaneScope = { kind: "subtask", stepId: "dispatch", n: 1 };
const override = (scope: LaneScope, execution: LaneOverride["execution"]): LaneOverride => ({ scope, execution, operationId: "op-1", at: 123 });

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

describe("execution selection", () => {
  it("uses a complete request before the repo default and does not inherit its model", () => {
    expect(selectExecution({ agent: "codex" }, { agent: "claude", model: "sonnet" })).toEqual({ execution: { agent: "codex" }, source: "request" });
    expect(selectExecution({ agent: "workflow" }, { agent: "codex", model: "gpt-test" })).toEqual({ execution: { agent: "workflow" }, source: "request" });
  });

  it("uses repo defaults only for new runs without a request", () => {
    expect(selectExecution(undefined, { agent: "codex", model: "gpt-test" })).toEqual({ execution: { agent: "codex", model: "gpt-test" }, source: "repo" });
    expect(selectExecution()).toEqual({ execution: { agent: "workflow" }, source: "workflow" });
    expect(executionOfRun({})).toEqual({ agent: "workflow" });
    expect(executionOfRun({ execution: { agent: "copilot" } })).toEqual({ agent: "copilot" });
  });

  it.each([undefined, "default", "inherit"])("keeps %s as no model flag", (model) => {
    expect(parseExecution({ agent: "codex", ...(model === undefined ? {} : { model }) })).toEqual({ agent: "codex" });
  });

  it.each([
    null,
    [],
    "codex",
    {},
    { agent: "other" },
    { agent: "workflow", model: "sonnet" },
    { agent: "codex", model: "" },
    { agent: "codex", model: "--flag" },
    { agent: "codex", model: "two words" },
    { agent: "claude", model: "gpt-test" },
    { agent: "codex", permissionMode: "auto" },
  ])("rejects invalid choices instead of falling back: %j", (value) => {
    expect(() => selectExecution(value, { agent: "claude" })).toThrow(ExecutionValidationError);
  });

  it("accepts a syntactically safe id without claiming it is available", () => {
    expect(parseExecution({ agent: "codex", model: "future-model" })).toEqual({ agent: "codex", model: "future-model" });
    expect(() => selectExecution(undefined, { agent: "bad" })).toThrow(ExecutionValidationError);
  });
});

describe("effective execution", () => {
  it("keeps the legacy mixed workflow, including table subagent/model and permission", () => {
    const def = freeze(workflow());
    expect(resolveExecution({ workflow: def, scope: main })).toEqual({ agent: "claude", model: "opus", permissionMode: "acceptEdits", source: "workflow", modelSource: "explicit" });
    expect(resolveExecution({ workflow: def, scope: { kind: "step", stepId: "review" }, run: {} }).agent).toBe("copilot");
    expect(resolveExecution({ workflow: def, scope: member, assignment: assignment({ subagent: "member-helper" }) })).toEqual({
      agent: "claude",
      model: "sonnet",
      subagent: "member-helper",
      permissionMode: "acceptEdits",
      source: "assignment",
      modelSource: "explicit",
    });
  });

  it("keeps pre-agent workflow snapshots on Claude", () => {
    const def = JSON.parse(JSON.stringify(workflow()));
    delete def.agent;
    delete def.steps[0].agent;
    expect(resolveExecution({ workflow: freeze(def), scope: main })).toMatchObject({ agent: "claude", model: "opus", source: "workflow" });
  });

  it.each(["claude", "copilot", "codex"] as const)("applies %s to every step without carrying over workflow/step models", (agent) => {
    const snapshot = snapshotExecution(freeze(workflow()), { execution: { agent }, source: "request" });
    expect(Object.values(snapshot.steps)).toHaveLength(3);
    for (const step of Object.values(snapshot.steps)) {
      expect(step).toEqual({ agent, permissionMode: "acceptEdits", source: "execution", modelSource: "default" });
      expect(step).not.toHaveProperty("actualModel");
    }
  });

  it("persists selection provenance and detached configurations without mutating inputs", () => {
    const def = freeze(workflow());
    const selected = freeze(selectExecution(undefined, { agent: "codex", model: "gpt-test" }));
    const before = JSON.stringify({ def, selected });
    const snapshot = snapshotExecution(def, selected);
    expect(snapshot).toMatchObject({ version: 1, execution: { agent: "codex", model: "gpt-test" }, source: "repo" });
    for (const step of Object.values(snapshot.steps)) expect(step.model).toBe("gpt-test");
    snapshot.steps.investigate.agent = "claude";
    snapshot.execution.agent = "copilot";
    expect(JSON.stringify({ def, selected })).toBe(before);
    expect(def.steps[2]).toMatchObject({ agent: "copilot", model: "review-model" });
  });

  it("limits a main override to its step and preserves it after JSON reload", () => {
    const run = JSON.parse(JSON.stringify({ execution: { agent: "codex", model: "gpt-test" }, laneOverrides: { [laneKey(main)]: override(main, { agent: "copilot" }) } }));
    freeze(run);
    expect(resolveExecution({ workflow: workflow(), scope: main, run })).toMatchObject({ agent: "copilot", source: "lane-override", modelSource: "default" });
    expect(resolveExecution({ workflow: workflow(), scope: main, run })).not.toHaveProperty("model");
    expect(resolveExecution({ workflow: workflow(), scope: { kind: "step", stepId: "review" }, run })).toMatchObject({ agent: "codex", model: "gpt-test", source: "execution" });
  });

  it("allows a deliberate member exception without weakening the policy for another member", () => {
    const run = freeze({ execution: { agent: "codex" as const }, laneOverrides: { [laneKey(member)]: override(member, { agent: "claude", model: "opus" }) } });
    expect(resolveExecution({ workflow: workflow(), scope: member, run, assignment: assignment({ agent: "codex", model: undefined }) })).toMatchObject({
      agent: "claude",
      model: "opus",
      source: "lane-override",
    });
    expect(() => resolveExecution({ workflow: workflow(), scope: { ...member, n: 2 }, run, assignment: assignment({ n: 2 }) })).toThrow("subtask 2: agent: must be codex");
  });

  it("keeps a same-CLI subagent and refuses to drop cross-CLI restrictions", () => {
    const row = freeze(assignment({ subagent: "limited" }));
    const run = { laneOverrides: { [laneKey(member)]: override(member, { agent: "claude", model: "opus" }) } };
    expect(resolveExecution({ workflow: workflow(), scope: member, run, assignment: row })).toMatchObject({ agent: "claude", model: "opus", subagent: "limited" });
    run.laneOverrides[laneKey(member)] = override(member, { agent: "copilot" });
    expect(() => resolveExecution({ workflow: workflow(), scope: member, run, assignment: row })).toThrow("equivalent restrictions");
    expect(row.subagent).toBe("limited");
  });

  it("blocks Codex plan without rewriting permission, for policies and overrides", () => {
    const def = freeze({ ...workflow(), permissionMode: "plan" });
    expect(() => snapshotExecution(def, selectExecution({ agent: "codex" }))).toThrow("permissionMode");
    expect(() => resolveExecution({ workflow: def, scope: main, run: { laneOverrides: { [laneKey(main)]: override(main, { agent: "codex" }) } } })).toThrow("permissionMode");
    expect(def.permissionMode).toBe("plan");
  });

  it("rejects incorrect lane identities", () => {
    expect(laneKey(main)).not.toBe(laneKey({ kind: "subtask", stepId: "investigate", n: 1 }));
    expect(laneKey(member)).not.toBe(laneKey({ ...member, stepId: "dispatch:1" }));
    expect(() => resolveExecution({ workflow: workflow(), scope: { ...main, stepId: "missing" } })).toThrow("unknown step");
    expect(() => resolveExecution({ workflow: workflow(), scope: member })).toThrow("matching assignment");
    expect(() => resolveExecution({ workflow: workflow(), scope: { ...member, n: 2 }, assignment: assignment() })).toThrow("matching assignment");
    expect(() => resolveExecution({ workflow: workflow(), scope: main, run: { laneOverrides: { [laneKey(main)]: override(member, { agent: "codex" }) } } })).toThrow("scope does not match");
    expect(resolveExecution({ workflow: workflow(), scope: member, assignment: assignment({ agent: "codex", subagent: "limited" }) })).toMatchObject({ agent: "codex", subagent: "limited" });
  });
});

describe("assignment policy", () => {
  it("reports row, field and expected value without changing the table", () => {
    const rows = freeze([assignment({ n: 3, subagent: "limited" })]);
    expect(assignmentExecutionProblems(rows, { agent: "codex", model: "gpt-test" })).toEqual([
      { n: 3, field: "agent", message: "must be codex" },
      { n: 3, field: "model", message: "must be gpt-test" },
      { n: 3, field: "subagent", message: "must be absent for codex; use a compatible assignment" },
    ]);
    expect(rows[0]).toMatchObject({ agent: "claude", model: "sonnet", subagent: "limited" });
  });

  it.each([undefined, "default", "inherit"])("accepts parsed default model %s but rejects a concrete model under the default policy", (model) => {
    expect(assignmentExecutionProblems([assignment({ agent: "codex", model })], { agent: "codex" })).toEqual([]);
    expect(assignmentExecutionProblems([assignment({ agent: "codex", model: "gpt-test" })], { agent: "codex" })).toMatchObject([{ n: 1, field: "model" }]);
  });

  it("preserves mixed rows in workflow mode and a same-agent subagent under concrete policy", () => {
    const rows = [assignment({ subagent: "limited" }), assignment({ n: 2, agent: "copilot", model: "custom-model" })];
    expect(assignmentExecutionProblems(rows)).toEqual([]);
    expect(assignmentExecutionProblems(rows, { agent: "workflow" })).toEqual([]);
    expect(assignmentExecutionProblems([rows[0]], { agent: "claude", model: "sonnet" })).toEqual([]);
    expect(resolveExecution({ workflow: workflow(), scope: member, run: { execution: { agent: "claude", model: "sonnet" } }, assignment: rows[0] }).subagent).toBe("limited");
  });
});

describe("repo settings AST merge", () => {
  const current =
    "# team settings\nmode: leader # selected mode\nexecutionVersion: 1\nexecution:\n  agent: codex # selected CLI\n  model: gpt-test # requested model\nfuture:\n  enabled: true # keep this\n";

  it("reads legacy mode-only settings and versions an execution choice", () => {
    expect(parseRepoSettings("mode: leader\n")).toEqual({ mode: "leader" });
    expect(parseRepoSettings("")).toEqual({});
    expect(parseRepoSettings(current)).toEqual({ mode: "leader", executionVersion: 1, execution: { agent: "codex", model: "gpt-test" } });
    expect(parseRepoSettings("execution: {agent: workflow}\n")).toEqual({ executionVersion: 1, execution: { agent: "workflow" } });
  });

  it("preserves execution, comments and unknown fields during mode-only edits", () => {
    const next = settingsText("default", current);
    expect(parse(next)).toEqual({ ...parse(current), mode: "default" });
    for (const comment of ["# team settings", "# selected mode", "# selected CLI", "# requested model", "# keep this"]) expect(next).toContain(comment);
    expect(settingsText("leader")).toContain("\nmode: leader\n");
  });

  it("patches execution without losing unrelated fields or carrying an old model", () => {
    const next = patchRepoSettings(current, { execution: { agent: "copilot" } });
    expect(parse(next)).toEqual({ mode: "leader", executionVersion: 1, execution: { agent: "copilot" }, future: { enabled: true } });
    expect(next).toContain("# selected CLI");
    expect(next).toContain("# keep this");
    expect(parse(patchRepoSettings(next, { execution: { agent: "workflow" } })).execution).toEqual({ agent: "workflow" });
    expect(parse(patchRepoSettings(next, { execution: null }))).toEqual({ mode: "leader", future: { enabled: true } });
  });

  it("preserves fields it cannot interpret rather than erasing them during an unrelated edit", () => {
    const unknown = "executionVersion: 42\nexecution: {agent: future, extra: keep}\nother: [a, b]\n";
    expect(parse(patchRepoSettings(unknown, { mode: "leader" }))).toEqual({ ...parse(unknown), mode: "leader" });
    expect(() => patchRepoSettings(unknown, { execution: { agent: "codex" } })).toThrow("unsupported version");
    const extra = "execution: {agent: codex, future: keep}\n";
    expect(parse(patchRepoSettings(extra, { execution: { agent: "copilot" } })).execution).toEqual({ agent: "copilot", future: "keep" });
    expect(parseRepoSettings(extra).errors).toBeDefined();
  });

  it.each(["mode: [", "- sequence", "scalar"])("diagnoses malformed settings and refuses to overwrite them: %s", (text) => {
    expect(parseRepoSettings(text).errors).toMatchObject([{ field: "settings" }]);
    expect(() => patchRepoSettings(text, { mode: "leader" })).toThrow(ExecutionValidationError);
  });

  it.each([
    "execution: null",
    "execution: {agent: other}",
    "executionVersion: 2\nexecution: {agent: codex}",
    "execution: {agent: workflow, model: sonnet}",
    "execution: {agent: codex, model: --flag}",
  ])("surfaces invalid execution without a runnable default: %s", (text) => {
    const settings = parseRepoSettings(`mode: leader\n${text}\n`);
    expect(settings.mode).toBe("leader");
    expect(settings.errors?.length).toBeGreaterThan(0);
    expect(settings.execution).toBeUndefined();
  });

  it("quotes mode names safely and creates settings from an empty file", () => {
    expect(parse(settingsText("leader # comment")).mode).toBe("leader # comment");
    expect(parse(patchRepoSettings("", { execution: { agent: "codex", model: "gpt-test" } }))).toEqual({ executionVersion: 1, execution: { agent: "codex", model: "gpt-test" } });
    expect(() => patchRepoSettings(current, { mode: "" })).toThrow(ExecutionValidationError);
  });
});

describe("persisted compatibility", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const temp = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "taskpilot-execution-"));
    dirs.push(dir);
    return dir;
  };

  it("reads repo defaults and surfaces malformed files independently of mode", async () => {
    const repo = await temp();
    expect(await readRepoSettings(repo)).toEqual({});
    await mkdir(path.join(repo, ".taskpilot"));
    const file = path.join(repo, ".taskpilot/settings.yml");
    await writeFile(file, "mode: leader\nexecution: {agent: codex}\n");
    expect(await readRepoSettings(repo)).toEqual({ mode: "leader", executionVersion: 1, execution: { agent: "codex" } });
    await writeFile(file, "mode: [");
    expect(await readRepoSettings(repo)).toEqual({});
    expect((await readRepoSettings(repo, { diagnostics: true })).errors).toBeDefined();
    await writeFile(file, "mode: 3\n");
    expect(await readRepoSettings(repo)).toEqual({});
    expect((await readRepoSettings(repo, { diagnostics: true })).errors).toMatchObject([{ field: "mode" }]);
  });

  it("round-trips execution and session metadata while keeping legacy runs untouched", async () => {
    const dir = await temp();
    const legacy: RunState = {
      repo: "/repo",
      taskKey: "OLD",
      sessionId: "source",
      stepIndex: 0,
      phase: "interrupted",
      stepStartedAt: 1,
      message: "",
      startedAt: 1,
      updatedAt: 1,
      workflow: workflow(),
    };
    await writeFile(path.join(dir, "state.json"), JSON.stringify({ sessions: [{ id: "source", repo: "/repo", taskKey: "OLD", title: "Old", createdAt: 1 }], runs: [legacy] }));
    const store = new StateStore(dir);
    expect((await store.load()).runs[0]).not.toHaveProperty("execution");
    expect(executionOfRun((await store.load()).runs[0])).toEqual({ agent: "workflow" });
    const execution: ExecutionSelection = { agent: "codex" };
    await store.update((state) => {
      state.runs.push({
        ...legacy,
        taskKey: "NEW",
        execution,
        executionSnapshot: snapshotExecution(workflow(), { execution, source: "request" }),
        laneOverrides: { [laneKey(main)]: override(main, { agent: "copilot" }) },
        handoffs: [],
        attempts: [],
      });
      state.sessions[0].reservation = { operationId: "op-1", role: "source", at: 2 };
      state.sessions[0].retired = { operationId: "op-0", replacedBy: "target", at: 1 };
      state.sessions[0].generation = 3;
      state.sessions[0].processOwner = { pid: 123, startedAt: 1, generation: 3 };
    });
    const reloaded = await new StateStore(dir).load();
    expect(reloaded.runs[0]).toEqual(legacy);
    expect(reloaded.sessions[0]).toMatchObject({ reservation: { operationId: "op-1" }, retired: { replacedBy: "target" }, generation: 3, processOwner: { pid: 123 } });
    expect(resolveExecution({ workflow: reloaded.runs[1].workflow!, scope: main, run: reloaded.runs[1] })).toMatchObject({ agent: "copilot", source: "lane-override" });
    expect(JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"))).toEqual(reloaded);
  });
});
