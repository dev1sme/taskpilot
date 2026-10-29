import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore, type SessionMeta } from "../../../src/core/state.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import { loadWorkflow } from "../../../src/modules/workflow/index.js";
import type { RunState } from "../../../src/modules/workflow/types.js";
import type { SessionView } from "../../../src/modules/sessions/types.js";

let dir: string;
let state: StateStore;
let engine: WorkflowEngine;
let live: SessionView;
let meta: SessionMeta;
const measurement = (offset = 10) => ({
  source: "codex-thread" as const,
  inputTokens: 12,
  outputTokens: 3,
  costUsd: 999,
  availability: { state: "available" as const, checkedAt: 100 },
  sample: { nativeId: "root", fileId: "file", offset },
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tpl039-workflow-"));
  state = new StateStore(path.join(dir, "state"));
  meta = { id: "session", nativeId: "root", agent: "codex", generation: 2, repo: dir, taskKey: "DEMO-1", title: "Codex", createdAt: 1 };
  live = { ...meta, agent: "codex", status: "running", exitCode: null, activity: "busy" };
  const workflow = await loadWorkflow(dir, "solo");
  const run: RunState = {
    repo: dir,
    taskKey: "DEMO-1",
    sessionId: meta.id,
    stepIndex: 0,
    phase: "running",
    stepStartedAt: 1,
    promptId: "p1",
    message: "",
    startedAt: 1,
    updatedAt: 1,
    workflow,
  };
  await state.update((s) => {
    s.sessions.push(meta);
    s.runs.push(run);
  });
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected control operation");
  };
  engine = new WorkflowEngine(state, {
    get: async () => live,
    create: unused,
    resume: unused,
    stop: unused,
    paste: () => {
      throw new Error("Unexpected prompt");
    },
    hookSeen: () => false,
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("persists availability without counters and preserves cumulative snapshots across generations", async () => {
  await engine.onMetrics(meta, { source: "codex-thread", availability: { state: "missing", reason: "file-missing" } });
  expect((await state.load()).runs[0].sessionMetrics?.[0]).toMatchObject({ metrics: {}, availability: { state: "missing" } });
  await engine.onMetrics(meta, measurement());
  await engine.onMetrics(meta, measurement());
  live.generation = 3;
  await engine.onMetrics({ ...meta, generation: 3 }, measurement(20));
  const saved = (await new StateStore(state.dir).load()).runs[0];
  expect(saved.sessionMetrics).toHaveLength(1);
  expect(saved.sessionMetrics![0]).toMatchObject({ metrics: { inputTokens: 12, outputTokens: 3 }, generation: 3, nativeId: "root" });
  expect(saved.sessionMetrics![0].metrics.costUsd).toBeUndefined();
  expect(saved.phase).toBe("running");
});
it("rejects metrics and completion from old generations and reserved/retired sessions", async () => {
  await engine.onMetrics({ ...meta, generation: 1 }, measurement());
  await engine.onEvent({ ...meta, generation: 1 }, { sessionId: meta.id, provider: "codex", type: "turn.completed" });
  expect((await state.load()).runs[0].sessionMetrics).toBeUndefined();
  expect((await state.load()).runs[0].phase).toBe("running");
  live.reservation = { operationId: "handoff", role: "source", at: 1 };
  await engine.onMetrics(meta, measurement());
  expect((await state.load()).runs[0].sessionMetrics).toBeUndefined();
  delete live.reservation;
  live.retired = { operationId: "handoff", replacedBy: "target", at: 1 };
  await engine.onEvent(meta, { sessionId: meta.id, provider: "codex", type: "turn.completed" });
  expect((await state.load()).runs[0].phase).toBe("running");
});
it("keeps Interrupt waiting and never advances the workflow step", async () => {
  await engine.onEvent(meta, { sessionId: meta.id, provider: "codex", type: "turn.interrupted" });
  expect((await state.load()).runs[0]).toMatchObject({ phase: "waiting", stepIndex: 0 });
});
it("keeps attempt projections consistent when a newer sample lacks one counter", async () => {
  await state.update((s) => {
    s.runs[0].attempts = [
      {
        id: "attempt",
        sessionId: meta.id,
        generation: 2,
        scope: { kind: "step", stepId: "investigate" },
        execution: { agent: "codex", model: "gpt-6.1-sol", source: "execution", modelSource: "explicit" },
        startedAt: 1,
      },
    ];
  });
  await engine.onMetrics(meta, measurement());
  await engine.onMetrics(meta, { ...measurement(20), inputTokens: 14, outputTokens: undefined });
  const attempt = (await state.load()).runs[0].attempts![0];
  expect(attempt.metrics?.inputTokens).toBe(14);
  expect(attempt.metrics?.outputTokens).toBeUndefined();
  expect(attempt.metrics?.costUsd).toBeUndefined();
});
