import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createSafeText, REDACTED } from "../../../src/core/safe-text.js";
import { summarizeMetrics } from "../../../src/modules/workflow/history.js";
import { laneKey } from "../../../src/modules/workflow/execution.js";
import { buildHandoff, HandoffBuildError, type BuildHandoffInput, type HandoffRequest, type HandoffCommitRequest } from "../../../src/modules/workflow/handoff.js";
import type { HandoffJournal, RunState, SubtaskRun, WorkflowDef } from "../../../src/modules/workflow/types.js";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import { codexTuiLauncher, seedCodexThread, startHookServer, type HookServer } from "../../helpers/codex-tui.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";
import { fireHook } from "../../helpers/session-events.js";

const safe = createSafeText([]);

const managers: Array<{ manager: SessionManager; state: StateStore }> = [];
const hookServers: HookServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { manager, state } of managers.splice(0)) {
    for (const meta of (await state.load()).sessions) await manager.stopAndWait(meta.id).catch(() => undefined);
    manager.closeAll();
  }
  await Promise.all(hookServers.splice(0).map((server) => server.close()));
});
afterAll(cleanupTempDirs);

async function transactionFixture(kind: "step" | "subtask" = "step", prompt = "Continue the current work", initialAgent: "claude" | "codex" = "codex") {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("handoff-transaction-"));
  const log = path.join(state.dir, "rpc.jsonl");
  const faults: Record<string, string> = { FAKE_CODEX_LOG: log };
  const hooks = await startHookServer();
  hookServers.push(hooks);
  const managerOptions = {
    hookUrl: hooks.url,
    launchers: {
      claude: () => ({ file: "/bin/bash", args: ["-c", "while IFS= read -r line; do :; done"] }),
      // `faults` is read at each launch, so a test can arm one between launches.
      codex: codexTuiLauncher(faults),
      copilot: () => ({ file: "/bin/bash", args: ["-c", 'echo "/ commands"; while IFS= read -r line; do :; done'] }),
    },
  };
  const manager = new SessionManager(state, managerOptions);
  hooks.attach(manager);
  managers.push({ manager, state });
  const ready = manager.waitForReady.bind(manager);
  vi.spyOn(manager, "waitForReady").mockImplementation(async (id, options) => {
    if ((await manager.get(id)).agent === "claude") {
      const token = (manager as unknown as { live: Map<string, { hookToken: string }> }).live.get(id)!.hookToken;
      await manager.handleHook(token, "SessionStart", { session_id: id });
    }
    return ready(id, options);
  });
  const def = fixture("step").workflow;
  def.steps = [
    { ...def.steps[2], id: "review", agent: "codex", prompt },
    { ...def.steps[2], id: "next", agent: "codex" },
  ];
  const engine = new WorkflowEngine(
    state,
    manager,
    async () => def,
    undefined,
    undefined,
    async () => createSafeText(["opaque-private-value"]),
  );
  manager.on("event", (meta, event) => void engine.onEvent(meta, event));
  manager.on("exit", (meta) => void engine.onExit(meta));
  const started = await engine.start(repo, "DEMO-1", { execution: { agent: initialAgent } });
  if (initialAgent === "claude") {
    await manager.waitForReady(started.sessionId);
    await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("running"));
    await fireHook(engine, await manager.get(started.sessionId), "Stop");
  }
  const read = async () => (await state.load()).runs[0];
  await vi.waitFor(async () => expect(["waiting", "running"]).toContain((await read()).phase));
  if (!prompt.includes("APPROVAL")) await vi.waitFor(async () => expect((await read()).phase).toBe("waiting"));
  if (kind === "subtask") {
    const current = structuredClone(await read());
    const sample = fixture("subtask");
    const leader = await manager.create(repo, "DEMO-1", { agent: "codex" });
    current.workflow = sample.workflow;
    current.stepIndex = 1;
    current.phase = "running";
    current.subtasks = sample.run.subtasks!.map((sub) => ({
      ...sub,
      agent: initialAgent,
      ...(sub.n === 2
        ? {
            sessionId: current.sessionId,
            phase: "waiting",
            sentPrompt: { stepIndex: 1, text: prompt, at: current.stepStartedAt },
          }
        : {}),
    }));
    current.sessionId = leader.id;
    current.attempts = current.attempts!.map((attempt) => ({ ...attempt, scope: { kind: "subtask", stepId: "work", n: 2 } }));
    await state.update((s) => {
      s.runs[0] = current;
    });
  }
  const request: HandoffRequest = { scope: kind === "step" ? { kind: "step", stepId: "review" } : { kind: "subtask", stepId: "work", n: 2 }, target: { agent: "codex" } };
  const commitRequest = (preview: Awaited<ReturnType<WorkflowEngine["previewHandoff"]>>["preview"], operationId = "operation-1"): HandoffCommitRequest => ({
    ...request,
    previewId: preview.id,
    fingerprint: preview.fingerprint,
    sourceSessionId: preview.sourceSessionId,
    expectedGeneration: preview.expectedGeneration,
    operationId,
    confirmStop: true,
  });
  return { repo, state, log, faults, hooks, manager, managerOptions, engine, read, request, commitRequest };
}

function fixture(kind: "step" | "subtask" = "subtask"): BuildHandoffInput {
  const workflow: WorkflowDef = {
    source: "/repo/.taskpilot/workflow.yml",
    origin: "repo",
    dir: "/repo/.taskpilot",
    agent: "claude",
    history: { file: "00-history.md", entry: "history" },
    language: "Viết tài liệu bằng tiếng Việt.",
    rules: ["No push or merge"],
    steps: [
      {
        id: "plan",
        title: "Plan",
        agent: "claude",
        prompt: "unused template",
        promptFile: "plan.md",
        outputs: [{ id: "plan", file: "02-plan.md", content: "approved plan" }],
        gate: "approve",
      },
      {
        id: "work",
        title: "Work",
        agent: "claude",
        prompt: "unused template",
        promptFile: "work.md",
        outputs: [],
        gate: "none",
        dispatch: { from: "plan", prompt: "unused dispatch", promptFile: "member.md", report: "03-viec-{{n}}.md", parallel: 2 },
      },
      {
        id: "review",
        title: "Review",
        agent: "claude",
        prompt: "unused template",
        promptFile: "review.md",
        outputs: [{ id: "summary", file: "04-summary.md", content: "review results" }],
        doneWhen: { output: "summary", file: "04-summary.md" },
        gate: "approve",
      },
    ],
  };
  const member = (n: number, phase: SubtaskRun["phase"], deps: number[] = []): SubtaskRun => ({
    n,
    title: `Work ${n}`,
    agent: "claude",
    files: [`server/src/member-${n}.ts`],
    output: `Result ${n}`,
    deps,
    phase,
    sessionId: `member-${n}`,
    report: `03-viec-${n}.md`,
    startedAt: 1_000,
    stepStartedAt: 2_000,
    sentPrompt: { stepIndex: 1, text: `Actually sent to ${n}`, at: 2_000 },
    lastMessage: `Unverified message ${n}`,
  });
  const run: RunState = {
    repo: "/repo",
    taskKey: "TPL-032",
    sessionId: "leader-session",
    stepIndex: kind === "step" ? 2 : 1,
    phase: "running",
    stepStartedAt: 2_000,
    startedAt: 1_000,
    updatedAt: 2_001,
    message: "Engine progress",
    lastMessage: "Claimed code complete, no report checked",
    sentPrompt: { stepIndex: kind === "step" ? 2 : 1, text: "Actually sent to leader", at: 2_000 },
    workflow,
    subtasks: [member(1, "done"), member(2, "running", [1]), member(3, "running")],
  };
  return {
    task: { key: "TPL-032", title: "Continue work" },
    workflow,
    run,
    scope: kind === "step" ? { kind: "step", stepId: "review" } : { kind: "subtask", stepId: "work", n: 2 },
    target: { agent: "codex" },
    generation: 3,
    createdAt: 3_000,
    files: [
      { path: ".claude/tasks/TPL-032/02-plan.md", status: "present" },
      { path: ".claude/tasks/TPL-032/03-viec-2.md", status: "missing" },
    ],
  };
}

describe("metrics provenance across handoff", () => {
  it.each([
    ["step", "claude"],
    ["subtask", "claude"],
    ["step", "codex"],
    ["subtask", "codex"],
  ] as const)("keeps %s source %s separate from target and survives reload", async (kind, initialAgent) => {
    const f = await transactionFixture(kind, "Continue the current work", initialAgent);
    const sourceId = kind === "step" ? (await f.read()).sessionId : (await f.read()).subtasks![1].sessionId!;
    const source = await f.manager.get(sourceId);
    if (initialAgent === "claude") await f.engine.onStatusLine(source, { model: { id: "claude-measured" }, cost: { total_cost_usd: 0.42 } });
    else {
      await f.engine.onMetrics(source, { source: "codex-thread", model: "codex-measured", inputTokens: 100, outputTokens: 20 });
      await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 100, outputTokens: 20 });
      await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 150 });
    }
    f.request.target = { agent: initialAgent === "claude" ? "codex" : "claude" };
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const { operation } = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    const target = await f.manager.get(operation.targetSessionId!);
    if (initialAgent === "claude") {
      await f.engine.onMetrics(target, { source: "codex-thread", model: "target-codex", inputTokens: 200, outputTokens: 30 });
      await f.engine.onMetrics(target, { source: "codex-thread", inputTokens: 200, outputTokens: 30 });
    } else await f.engine.onStatusLine(target, { model: { id: "target-claude" }, cost: { total_cost_usd: 0.9 } });
    const after = structuredClone(await f.read());
    await f.engine.onStatusLine({ ...source, agent: "claude" }, { cost: { total_cost_usd: 999 } });
    await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 999 });
    expect(await f.read()).toEqual(after);
    const summary = summarizeMetrics(after, f.request.scope);
    expect(summary.sessions).toHaveLength(2);
    const old = summary.sessions.find((session) => session.sessionId === sourceId)!;
    const next = summary.sessions.find((session) => session.sessionId === target.id)!;
    expect(old.measurements[0].source).toBe(initialAgent === "claude" ? "claude-statusline" : "codex-thread");
    expect(next.measurements[0].source).toBe(initialAgent === "claude" ? "codex-thread" : "claude-statusline");
    expect(old.metrics).toEqual(initialAgent === "claude" ? { costUsd: 0.42 } : { inputTokens: 150, outputTokens: 20 });
    expect(next.metrics).toEqual(initialAgent === "claude" ? { inputTokens: 200, outputTokens: 30 } : { costUsd: 0.9 });
    expect(summary.totals).toEqual({});
    expect(summary.coverage).toEqual({ inputTokens: 1, outputTokens: 1, costUsd: 1 });
    expect(after.attempts?.find((a) => a.sessionId === sourceId)).toMatchObject({
      actualModel: initialAgent === "claude" ? "claude-measured" : "codex-measured",
      finishedAt: expect.any(Number),
    });
    expect(after.attempts?.at(-1)).toMatchObject({ execution: { modelSource: "default" }, actualModel: initialAgent === "claude" ? "target-codex" : "target-claude" });
    expect(after.attempts?.at(-1)?.execution.model).toBeUndefined();
    const reloaded = (await new StateStore(f.state.dir).load()).runs[0];
    expect(summarizeMetrics(reloaded, f.request.scope)).toEqual(summary);
    const view = await f.engine.view(f.repo, "DEMO-1");
    expect(kind === "subtask" ? view.subtaskUsage[2] : view.usage).toEqual(summary);
    if (kind === "subtask") {
      const metrics = after.subtasks![1].metrics!;
      expect(metrics).not.toHaveProperty(initialAgent === "claude" ? "costUsd" : "inputTokens");
      await writeFile(path.join(f.repo, ".claude/tasks/DEMO-1/03-viec-2.md"), "member output after transfer");
      await fireHook(f.engine, await f.manager.get(target.id), "Stop");
      const history = await readFile(path.join(f.repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8");
      expect(history).toContain("Nguồn `claude-statusline`");
      expect(history).toContain("Nguồn `codex-thread`");
      expect(history).toContain(`Session \`${sourceId}\``);
      expect(history).toContain(`Session \`${target.id}\``);
    }
  });

  it("replaces cumulative counters across generations of the same native thread without adding attempts", async () => {
    const f = await transactionFixture();
    const source = await f.manager.get((await f.read()).sessionId);
    await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 100, outputTokens: 10 });
    await f.manager.stopAndWait(source.id);
    await f.engine.retry(f.repo, "DEMO-1");
    await vi.waitFor(async () => expect((await f.read()).phase).toBe("waiting"));
    const resumed = await f.manager.get(source.id);
    expect(resumed.nativeId).toBe(source.nativeId);
    expect(resumed.generation).toBeGreaterThan(source.generation!);
    await f.engine.onMetrics(resumed, { source: "codex-thread", inputTokens: 140, outputTokens: 14 });
    await f.engine.onMetrics(resumed, { source: "codex-thread", inputTokens: 140, outputTokens: 14 });
    await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 999 });
    const run = await f.read();
    expect(run.attempts).toHaveLength(2);
    const usage = (await f.engine.view(f.repo, "DEMO-1")).usage!;
    expect(usage.sessions).toHaveLength(1);
    expect(usage.totals).toEqual({ inputTokens: 140, outputTokens: 14 });
    expect(usage.totals).not.toHaveProperty("costUsd");
    expect(usage.sessions[0].attemptIds).toHaveLength(2);
    expect(run.attempts![0].metrics).toMatchObject({ inputTokens: 100, outputTokens: 10 });
    expect(run.attempts![1].metrics).toMatchObject({ inputTokens: 140, outputTokens: 14 });
  });

  it("ignores invalid counters and never accepts a cost from token notifications", async () => {
    // The first turn waits for approval, so no Stop hook has brought token counts yet.
    const f = await transactionFixture("step", "APPROVAL");
    const meta = await f.manager.get((await f.read()).sessionId);
    const invalid = { inputTokens: Number.NaN, outputTokens: -1, costUsd: 42 };
    await f.engine.onMetrics(meta, invalid);
    expect((await f.read()).sessionMetrics).toBeUndefined();
    const zero = { inputTokens: 0, outputTokens: Number.POSITIVE_INFINITY, costUsd: 42 };
    await f.engine.onMetrics(meta, zero);
    expect(summarizeMetrics(await f.read()).totals).toEqual({ inputTokens: 0 });
    const corrected = { inputTokens: 50, outputTokens: 5 };
    await f.engine.onMetrics(meta, corrected);
    await f.engine.onMetrics(meta, { inputTokens: 40 });
    expect(summarizeMetrics(await f.read()).totals).toEqual({ inputTokens: 40, outputTokens: 5 });
  });

  it("counts a leader session once when reused by the next workflow step", async () => {
    const f = await transactionFixture();
    const source = await f.manager.get((await f.read()).sessionId);
    await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 100, outputTokens: 10 });
    await writeFile(path.join(f.repo, ".claude/tasks/DEMO-1/04-summary.md"), "first step output");
    await fireHook(f.engine, source, "Stop");
    await f.engine.approve(f.repo, "DEMO-1");
    await f.engine.onMetrics(await f.manager.get(source.id), { source: "codex-thread", inputTokens: 150, outputTokens: 20 });
    const run = await f.read();
    expect(run.stepIndex).toBe(1);
    expect(run.sessionId).toBe(source.id);
    expect(run.attempts?.map((a) => a.scope.stepId)).toEqual(["review", "next"]);
    expect(summarizeMetrics(run).totals).toEqual({ inputTokens: 150, outputTokens: 20 });
  });

  it("preserves legacy flat source data before the member swap without borrowing its cost", async () => {
    const f = await transactionFixture("subtask", "APPROVAL");
    const sourceId = (await f.read()).subtasks![1].sessionId!;
    await f.state.update((state) => {
      state.runs[0].attempts = undefined;
      state.runs[0].subtasks![1].metrics = { costUsd: 2.5, model: "legacy-unverified-model" };
    });
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const { operation } = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    await f.engine.onMetrics(await f.manager.get(operation.targetSessionId!), { source: "codex-thread", inputTokens: 50 });
    const run = await f.read();
    const summary = summarizeMetrics(run);
    expect(summary.sessions.find((s) => s.sessionId === sourceId)).toMatchObject({ actualModels: [], measurements: [{ source: "legacy", basis: "unknown", metrics: { costUsd: 2.5 } }] });
    expect(run.subtasks![1].metrics).toEqual({ inputTokens: 50 });
    expect(summary.totals).not.toHaveProperty("costUsd");
  });
});

describe("handoff crash recovery and lane fences", () => {
  /** Build real durable crash points, then discard the manager that owns the original transports. */
  async function crashAt(point: string, kind: "step" | "subtask" = "step", priorHandoff = false) {
    const f = await transactionFixture(kind);
    if (kind === "subtask")
      await f.state.update((draft) => {
        // A dependent has never launched; unlike active lanes it must stay pending on server recovery.
        const dependent = draft.runs[0].subtasks![2];
        dependent.phase = "pending";
        dependent.sessionId = undefined;
        dependent.deps = [2];
      });
    if (priorHandoff) {
      const first = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
      await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(first.preview, "prior-operation"));
      await vi.waitFor(async () => expect((await f.read()).phase).toBe("waiting"));
    }
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    f.manager.removeAllListeners("hook");
    f.manager.removeAllListeners("exit");
    const operation: HandoffJournal = {
      operationId: "crash-operation",
      scope: f.request.scope,
      stage: "prepared",
      sourceSessionId: preview.sourceSessionId,
      expectedGeneration: preview.expectedGeneration,
      target: f.request.target,
      previewId: preview.id,
      fingerprint: preview.fingerprint,
      text: preview.prompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const save = async () =>
      f.state.update((state) => {
        state.runs[0].handoffs = [...(state.runs[0].handoffs ?? []).filter((entry) => entry.operationId !== operation.operationId), structuredClone(operation)];
      });
    await save();
    if (point !== "prepared") await f.manager.reserve(preview.sourceSessionId, operation.operationId);
    if (!["prepared", "reserved"].includes(point)) {
      await f.manager.stopAndWait(preview.sourceSessionId);
      if (point !== "source-exited") {
        operation.stage = "source-stopped";
        await save();
      }
    }
    if (["target-created", "target-spawned", "pending", "sending", "sent", "target-orphan"].includes(point)) {
      const target = await f.manager
        .create(f.repo, "DEMO-1", {
          agent: "codex",
          operationId: operation.operationId,
          beforeSpawn: async (allocated) => {
            operation.targetSessionId = allocated.id;
            if (point !== "target-orphan") {
              operation.stage = "target-created";
              await save();
            }
            if (point === "target-created") throw new Error("crash before spawn");
          },
        })
        .catch(async (error: unknown) => {
          if (point !== "target-created") throw error;
          return f.manager.get(operation.targetSessionId!);
        });
      if (point !== "target-created") await f.manager.waitForReady(target.id);
      if (["pending", "sending", "sent"].includes(point)) {
        operation.stage = "committed";
        operation.promptState = point as "pending" | "sending" | "sent";
        await f.state.update((state) => {
          const run = state.runs[0];
          const lane = kind === "step" ? run : run.subtasks![1];
          lane.sessionId = target.id;
          lane.phase = "interrupted";
          lane.pendingPrompt = preview.prompt;
          run.handoffs = [...(run.handoffs ?? []).filter((entry) => entry.operationId !== operation.operationId), structuredClone(operation)];
          run.laneOverrides = { [laneKey(f.request.scope)]: { scope: f.request.scope, operationId: operation.operationId, execution: f.request.target, at: Date.now() } };
          run.attempts!.push({ id: "target-attempt", scope: f.request.scope, sessionId: target.id, generation: target.generation!, execution: preview.target, startedAt: Date.now() });
        });
        if (point !== "pending") {
          await f.manager.retire(preview.sourceSessionId, operation.operationId, target.id);
          await f.manager.release(target.id, operation.operationId);
          // sending means input may already have reached the agent; recovery cannot infer otherwise.
          f.manager.paste(target.id, preview.prompt);
          // The prompt reached the TUI, so its first hook gave the thread an id that a later resume needs.
          await vi.waitFor(async () => expect((await f.manager.get(target.id)).nativeId).toBeTruthy());
        }
      }
    }
    const state = new StateStore(f.state.dir);
    const manager = new SessionManager(state, f.managerOptions);
    f.hooks.attach(manager);
    const engine = new WorkflowEngine(
      state,
      manager,
      async () => (await state.load()).runs[0].workflow!,
      undefined,
      undefined,
      async () => createSafeText(["opaque-private-value"]),
    );
    managers.push({ manager, state });
    return { ...f, recoveredState: state, recoveredManager: manager, recoveredEngine: engine, operation };
  }

  it.each(
    ["prepared", "reserved", "source-exited", "source-stopped", "target-created", "target-spawned", "target-orphan", "pending", "sending", "sent"].flatMap((point) =>
      (["step", "subtask"] as const).map((kind) => ({ point, kind })),
    ),
  )("restarts $kind at $point without a surviving writer or blind prompt replay", async ({ point, kind }) => {
    const f = await crashAt(point, kind);
    const before = structuredClone(await f.read());
    const paste = vi.spyOn(f.recoveredManager, "paste");
    const create = vi.spyOn(f.recoveredManager, "create");
    const resume = vi.spyOn(f.recoveredManager, "resume");
    await f.recoveredEngine.recover();
    const run = (await f.recoveredState.load()).runs[0];
    const committed = ["pending", "sending", "sent"].includes(point);
    const lane = kind === "step" ? run : run.subtasks![1];
    expect(lane).toMatchObject({ phase: "interrupted", sessionId: committed ? f.operation.targetSessionId : f.operation.sourceSessionId });
    if (kind === "subtask") {
      expect(run.sessionId).toBe(before.sessionId);
      expect(run.subtasks![0]).toEqual(before.subtasks![0]);
      expect(run.subtasks![2]).toEqual(before.subtasks![2]);
      expect(lane).toMatchObject({ deps: before.subtasks![1].deps, files: before.subtasks![1].files });
    }
    expect(run.handoffs![0]).toMatchObject({ stage: committed ? "committed" : "failed", cleanup: "complete", recovery: "interrupted" });
    expect(paste).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    for (const session of (await f.recoveredState.load()).sessions) {
      expect(session.processOwner).toBeUndefined();
      expect(session.exitedGeneration).toBe(session.generation);
      expect(session.reservation).toBeUndefined();
    }
    if (f.operation.targetSessionId) {
      const retired = await f.recoveredManager.get(committed ? f.operation.sourceSessionId : f.operation.targetSessionId);
      expect(retired.retired?.replacedBy).toBe(committed ? f.operation.targetSessionId : f.operation.sourceSessionId);
    }
    const history = path.join(f.repo, ".claude/tasks/DEMO-1/00-history.md");
    const first = await readFile(history, "utf8");
    await f.recoveredEngine.recover();
    expect(await readFile(history, "utf8")).toBe(first);
    // The old server is no longer allowed to flush its cached state.
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it.each(["reserved", "pending"])("recovers consecutive transfers at %s without stealing a newer source reservation", async (point) => {
    const f = await crashAt(point, "step", true);
    await f.recoveredEngine.recover();
    const run = (await f.recoveredState.load()).runs[0];
    expect(run.handoffs).toHaveLength(2);
    expect(run.handoffs!.map((operation) => operation.cleanup)).toEqual(["complete", "complete"]);
    expect(run.sessionId).toBe(point === "pending" ? f.operation.targetSessionId : f.operation.sourceSessionId);
    expect(run.phase).toBe("interrupted");
    expect((await f.recoveredState.load()).sessions.every((session) => !session.reservation && !session.processOwner)).toBe(true);
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it("recovers a member binding and preserves completed siblings, deps and lane policy", async () => {
    const f = await crashAt("pending", "subtask");
    await f.recoveredState.update((state) => {
      state.runs[0].subtasks![2].phase = "done";
    });
    const before = structuredClone((await f.recoveredState.load()).runs[0]);
    await f.recoveredEngine.recover();
    const run = (await f.recoveredState.load()).runs[0];
    expect(run.sessionId).toBe(before.sessionId);
    expect(run.subtasks![0]).toEqual(before.subtasks![0]);
    expect(run.subtasks![2]).toEqual(before.subtasks![2]);
    expect(run.subtasks![1]).toMatchObject({ phase: "interrupted", sessionId: f.operation.targetSessionId, deps: before.subtasks![1].deps, files: before.subtasks![1].files });
    expect(run.laneOverrides).toEqual(before.laneOverrides);
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it.each(["target-spawned", "sending"])("keeps unknown process ownership locked at %s, rejects retry/restart/complete, then recovers deliberately", async (point) => {
    const f = await crashAt(point);
    const recover = vi.spyOn(f.recoveredManager, "recoverProcess").mockRejectedValueOnce(new Error("opaque-private-value ownership unknown"));
    await f.recoveredEngine.recover();
    const run = (await f.recoveredState.load()).runs[0];
    expect(run.handoffs![0]).toMatchObject({ cleanup: "blocked", recovery: "blocked" });
    expect(JSON.stringify(run.handoffs)).not.toContain("opaque-private-value");
    // No target is unlocked when the source cannot be verified.
    expect((await f.recoveredManager.get(f.operation.targetSessionId!)).reservation).toBeDefined();
    await expect(f.recoveredEngine.retry(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await expect(f.recoveredEngine.restart(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await expect(f.recoveredEngine.completeStep(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    recover.mockRestore();
    await f.recoveredEngine.recover();
    expect((await f.recoveredState.load()).runs[0].handoffs![0]).toMatchObject({ cleanup: "complete", recovery: "interrupted" });
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it("requires a deliberate retry to send the retained handoff prompt after recovery", async () => {
    const f = await crashAt("sending");
    await f.recoveredEngine.recover();
    const paste = vi.spyOn(f.recoveredManager, "paste");
    expect(paste).not.toHaveBeenCalled();
    const errors: unknown[] = [];
    f.recoveredManager.on("event", (meta, event) => void f.recoveredEngine.onEvent(meta, event).catch((error) => errors.push(error)));
    const resume = vi.spyOn(f.recoveredManager, "resume");
    await f.recoveredEngine.retry(f.repo, "DEMO-1");
    await vi.waitFor(() => expect(paste).toHaveBeenCalledExactlyOnceWith(f.operation.targetSessionId, f.operation.text));
    expect(resume).toHaveBeenCalledExactlyOnceWith(f.operation.targetSessionId);
    expect(errors).toEqual([]);
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it("keeps restart blocked when an unresolved process belongs to an earlier scope", async () => {
    const f = await crashAt("target-spawned");
    await f.recoveredState.update((draft) => {
      draft.runs[0].handoffs![0].cleanup = "blocked";
      draft.runs[0].stepIndex = 1;
      draft.runs[0].phase = "interrupted";
    });
    await expect(f.recoveredEngine.restart(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await f.recoveredEngine.recover();
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it("survives a failed recovery checkpoint and re-reconciles the last durable journal without input", async () => {
    const f = await crashAt("target-spawned");
    const update = f.recoveredState.update.bind(f.recoveredState);
    let failed = false;
    vi.spyOn(f.recoveredState, "update").mockImplementation((change) =>
      update((draft) => {
        change(draft);
        if (!failed && draft.runs[0].handoffs![0].recovery === "interrupted") {
          failed = true;
          throw new Error("recovery disk failure");
        }
      }),
    );
    await expect(f.recoveredEngine.recover()).rejects.toThrow("recovery disk failure");
    expect((await new StateStore(f.state.dir).load()).runs[0].handoffs![0].stage).toBe("target-created");
    const paste = vi.spyOn(f.recoveredManager, "paste");
    await f.recoveredEngine.recover();
    expect((await f.recoveredState.load()).runs[0].handoffs![0]).toMatchObject({ stage: "failed", cleanup: "complete", recovery: "interrupted" });
    expect(paste).not.toHaveBeenCalled();
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it.runIf(process.platform === "linux")("blocks a reused PID without signaling it and retains both session locks", async () => {
    const f = await crashAt("target-spawned");
    await f.recoveredState.update((draft) => {
      draft.sessions.find((session) => session.id === f.operation.sourceSessionId)!.processOwner = {
        pid: process.pid,
        startedAt: Date.now(),
        generation: 1,
        identity: "another-boot:42",
      };
    });
    await f.recoveredEngine.recover();
    expect((await f.recoveredState.load()).runs[0].handoffs![0]).toMatchObject({ cleanup: "blocked", recovery: "blocked" });
    expect((await f.recoveredManager.get(f.operation.sourceSessionId)).reservation).toBeDefined();
    expect((await f.recoveredManager.get(f.operation.targetSessionId!)).reservation).toBeDefined();
    expect(() => process.kill(process.pid, 0)).not.toThrow();
    await f.recoveredState.update((draft) => {
      delete draft.sessions.find((session) => session.id === f.operation.sourceSessionId)!.processOwner;
    });
    await f.recoveredEngine.recover();
    f.manager.closeAll();
    managers.splice(
      managers.findIndex((entry) => entry.manager === f.manager),
      1,
    );
  });

  it.each(["step", "subtask"] as const)("rejects source hooks, exits, metrics and statusline after %s handoff", async (kind) => {
    const f = await transactionFixture(kind, "APPROVAL");
    await vi.waitFor(async () => expect((await f.manager.get(kind === "step" ? (await f.read()).sessionId : (await f.read()).subtasks![1].sessionId!)).activity).toBe("permission"));
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const source = await f.manager.get(preview.sourceSessionId);
    const operation = (await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).operation;
    const before = structuredClone(await f.read());
    await fireHook(f.engine, source, "Stop", { last_assistant_message: "OLD" });
    await fireHook(f.engine, source, "SessionStart");
    await f.engine.onExit(source);
    await f.engine.onMetrics(source, { source: "codex-thread", inputTokens: 999999 });
    await f.engine.onStatusLine({ ...source, agent: "claude" }, { cost: { total_cost_usd: 999 } });
    expect(await f.read()).toEqual(before);
    expect((await f.manager.get(operation.targetSessionId!)).reservation).toBeUndefined();
  });

  it("baselines a report written during target startup before the handoff prompt", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const ready = f.manager.waitForReady.bind(f.manager);
    vi.spyOn(f.manager, "waitForReady").mockImplementationOnce(async (id, options) => {
      const result = await ready(id, options);
      await writeFile(path.join(f.repo, ".claude/tasks/DEMO-1/04-summary.md"), "pre-prompt report");
      return result;
    });
    const operation = (await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).operation;
    await fireHook(f.engine, await f.manager.get(operation.targetSessionId!), "Stop");
    expect((await f.read()).phase).toBe("waiting");
  });

  it.each(["step", "subtask"] as const)("does not accept a %s report from 50 ms before transfer, including manual complete", async (kind) => {
    const f = await transactionFixture(kind);
    // Freeze the wall clock so the old report is provably inside the 100 ms mtime slack.
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const name = kind === "step" ? "04-summary.md" : "03-viec-2.md";
    const report = path.join(f.repo, ".claude/tasks/DEMO-1", name);
    await writeFile(report, "old report");
    const near = new Date(Date.now() - 50);
    await utimes(report, near, near);
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const { operation } = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    const meta = await f.manager.get(operation.targetSessionId!);
    await fireHook(f.engine, meta, "Stop");
    if (kind === "step") {
      expect((await f.read()).phase).toBe("waiting");
      await expect(f.engine.completeStep(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    } else {
      expect((await f.read()).subtasks![1].phase).toBe("waiting");
      await expect(f.engine.completeSubtask(f.repo, "DEMO-1", 2)).rejects.toMatchObject({ status: 409 });
    }
    // Same mtime, different content: digest/ctime prove that a new write occurred.
    const oldMtime = (await stat(report)).mtime;
    await writeFile(report, "new report");
    await utimes(report, oldMtime, oldMtime);
    await fireHook(f.engine, meta, "Stop", { failed: true });
    const lane = kind === "step" ? await f.read() : (await f.read()).subtasks![1];
    expect(lane.phase).toBe("waiting");
    await fireHook(f.engine, meta, "Stop");
    expect((kind === "step" ? await f.read() : (await f.read()).subtasks![1]).phase).toBe(kind === "step" ? "gate" : "done");
  });
});

describe("handoff transactions with real session transports", () => {
  it("persists an idempotent preview without stopping, reserving or spawning", async () => {
    const f = await transactionFixture();
    const before = await f.manager.list(f.repo, "DEMO-1");
    const first = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const second = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    expect(first.preview).toEqual(second.preview);
    expect(first.requiresConfirmation).toBe(true);
    expect(await f.manager.list(f.repo, "DEMO-1")).toEqual(before);
    expect((await new StateStore(f.state.dir).load()).runs[0].handoffPreviews).toEqual([first.preview]);
    expect((await f.engine.view(f.repo, "DEMO-1")).run).not.toHaveProperty("handoffPreviews");
  });

  it("journals the target id before spawn, opens a fresh thread and commits duplicate requests once", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const source = await f.manager.get(preview.sourceSessionId);
    const original = f.manager.create.bind(f.manager);
    let checked = false;
    vi.spyOn(f.manager, "create").mockImplementation((repo, task, options = {}) =>
      original(repo, task, {
        ...options,
        beforeSpawn: async (allocated) => {
          await options.beforeSpawn?.(allocated);
          const durable = await new StateStore(f.state.dir).load();
          expect(durable.runs[0].handoffs).toMatchObject([{ stage: "target-created", targetSessionId: allocated.id }]);
          expect(durable.sessions.find((s) => s.id === allocated.id)).toMatchObject({ reservation: { operationId: "operation-1", role: "target" } });
          expect(durable.sessions.find((s) => s.id === allocated.id)?.nativeId).toBeUndefined();
          expect(durable.sessions.find((s) => s.id === allocated.id)?.processOwner).toBeUndefined();
          expect((await f.manager.get(source.id)).status).toBe("exited");
          checked = true;
        },
      }),
    );
    const paste = vi.spyOn(f.manager, "paste");
    const request = f.commitRequest(preview);
    const [first, second] = await Promise.all([f.engine.commitHandoff(f.repo, "DEMO-1", request), f.engine.commitHandoff(f.repo, "DEMO-1", request)]);
    expect(checked).toBe(true);
    expect(second.operation).toEqual(first.operation);
    expect(first.operation).toMatchObject({ stage: "committed", promptState: "sent" });
    const target = await f.manager.get(first.operation.targetSessionId!);
    expect(target.id).not.toBe(source.id);
    // The TUI names its thread with the first hook, which the handoff prompt triggers.
    await vi.waitFor(async () => expect((await f.manager.get(target.id)).nativeId).toBeTruthy());
    expect((await f.manager.get(target.id)).nativeId).not.toBe(source.nativeId);
    expect(target.reservation).toBeUndefined();
    expect(paste.mock.calls).toEqual([[target.id, preview.prompt]]);
    expect((await f.manager.get(source.id)).retired?.replacedBy).toBe(target.id);
    await expect(f.manager.resume(source.id)).rejects.toMatchObject({ status: 409 });
    const run = await f.read();
    expect(run.stepIndex).toBe(0);
    expect(run.execution).toEqual({ agent: "codex" });
    expect(run.laneOverrides?.[laneKey(f.request.scope)]).toMatchObject({ execution: { agent: "codex" }, operationId: request.operationId });
    expect(run.attempts?.at(-1)).toMatchObject({ sessionId: target.id, generation: 1, execution: { modelSource: "default" } });
    expect(run.workflow?.steps[1].agent).toBe("codex");
    const rpc = (await readFile(f.log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(rpc.filter((m) => m.method === "thread/start")).toHaveLength(2);
    expect(rpc.filter((m) => m.method === "thread/resume")).toHaveLength(0);
    const history = await readFile(path.join(f.repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8");
    expect(history.split("taskpilot-handoff:operation-1:committed")).toHaveLength(2);
    expect(history).toContain(preview.text);
  });

  it.each(["step", "subtask"] as const)("applies a cross-agent override only to the selected %s and preserves sibling progress", async (kind) => {
    const f = await transactionFixture(kind);
    f.request.target = { agent: "copilot" };
    const before = structuredClone(await f.read());
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    if (kind === "subtask") {
      await f.state.update((state) => {
        state.runs[0].subtasks![2].phase = "done";
      });
      before.subtasks![2].phase = "done";
    }
    const { operation } = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    const run = await f.read();
    expect((await f.manager.get(operation.targetSessionId!)).agent).toBe("copilot");
    expect(run.workflow).toEqual(before.workflow);
    expect(run.execution).toEqual(before.execution);
    expect(run.stepIndex).toBe(before.stepIndex);
    if (kind === "subtask") {
      expect(run.sessionId).toBe(before.sessionId);
      expect(run.subtasks![0]).toEqual(before.subtasks![0]);
      expect(run.subtasks![2]).toEqual(before.subtasks![2]);
      expect(run.subtasks![1]).toMatchObject({ agent: "codex", deps: [1], files: before.subtasks![1].files, sessionId: operation.targetSessionId, phase: "running" });
    } else expect(run.sessionId).toBe(operation.targetSessionId);
    expect(Object.keys(run.laneOverrides ?? {})).toEqual([laneKey(f.request.scope)]);
    const reloaded = (await new StateStore(f.state.dir).load()).runs[0];
    expect(reloaded.laneOverrides).toEqual(run.laneOverrides);
    // Retry must resolve the override without rewriting the assignment's original agent.
    await f.manager.stopAndWait(operation.targetSessionId!);
    if (kind === "subtask") await f.engine.retrySubtask(f.repo, "DEMO-1", 2);
    else await f.engine.retry(f.repo, "DEMO-1");
    expect((await f.manager.get(operation.targetSessionId!)).agent).toBe("copilot");
  });

  it("requires explicit stop/cancel approval consent before any mutation", async () => {
    const f = await transactionFixture("step", "APPROVAL");
    await vi.waitFor(async () => expect((await f.manager.get((await f.read()).sessionId)).activity).toBe("permission"));
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const commit = f.commitRequest(preview);
    delete commit.confirmStop;
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", commit)).rejects.toMatchObject({ status: 409 });
    expect((await f.read()).handoffs).toBeUndefined();
    expect((await f.manager.get(preview.sourceSessionId)).reservation).toBeUndefined();
    await f.engine.commitHandoff(f.repo, "DEMO-1", { ...commit, confirmStop: true });
    expect((await f.manager.get(preview.sourceSessionId)).status).toBe("exited");
  });

  it.each(["revision", "generation", "target", "preview", "fingerprint"])("rejects stale or changed %s without stopping the source", async (change) => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const request = f.commitRequest(preview);
    if (change === "revision")
      await f.state.update((s) => {
        s.runs[0].lastMessage = "new message";
      });
    if (change === "generation") request.expectedGeneration++;
    if (change === "target") request.target = { agent: "copilot" };
    if (change === "preview") request.previewId = "0".repeat(64);
    if (change === "fingerprint") request.fingerprint = "0".repeat(64);
    const stop = vi.spyOn(f.manager, "stopAndWait");
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", request)).rejects.toMatchObject({ status: 409 });
    expect(stop).not.toHaveBeenCalled();
    expect(await f.manager.list(f.repo, "DEMO-1")).toHaveLength(1);
  });

  it("revalidates preflight before reservation and leaves source and documents intact on failure", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const before = structuredClone(await f.read());
    vi.spyOn(f.manager, "preflight").mockRejectedValue(new Error("opaque-private-value unavailable"));
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).rejects.toThrow("[REDACTED] unavailable");
    expect(await f.read()).toEqual(before);
    expect((await f.manager.get(preview.sourceSessionId)).status).toBe("running");
  });

  it("does not spawn when the source exit barrier fails and keeps the source locked", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    vi.spyOn(f.manager, "stopAndWait").mockRejectedValueOnce(new Error("stop timeout"));
    const create = vi.spyOn(f.manager, "create");
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
    expect((await f.read()).handoffs?.[0]).toMatchObject({ stage: "failed", cleanup: "blocked" });
    expect((await f.manager.get(preview.sourceSessionId)).reservation?.operationId).toBe("operation-1");
    expect((await f.read()).phase).toBe("interrupted");
  });

  it("rolls back startup failure, never resumes source automatically, and allows a deliberate retry", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const resume = vi.spyOn(f.manager, "resume");
    vi.spyOn(f.manager, "waitForReady").mockRejectedValueOnce(new Error("opaque-private-value startup failure"));
    const request = f.commitRequest(preview);
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", request)).rejects.toThrow("[REDACTED] startup failure");
    const run = await f.read();
    const failed = run.handoffs![0];
    expect(failed).toMatchObject({ stage: "failed", cleanup: "complete" });
    expect(run.sessionId).toBe(preview.sourceSessionId);
    expect(run.laneOverrides).toBeUndefined();
    expect(run.phase).toBe("interrupted");
    expect(await f.manager.get(failed.targetSessionId!)).toMatchObject({ status: "exited", retired: { replacedBy: preview.sourceSessionId } });
    expect((await f.manager.get(preview.sourceSessionId)).reservation).toBeUndefined();
    expect(resume).not.toHaveBeenCalled();
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", request)).rejects.toMatchObject({ status: 409 });
    expect(await f.manager.list(f.repo, "DEMO-1")).toHaveLength(2);
    const output = JSON.stringify(failed) + (await readFile(path.join(f.repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8"));
    expect(output).not.toContain("opaque-private-value");
    await f.engine.retry(f.repo, "DEMO-1");
    expect(resume).toHaveBeenCalledWith(preview.sourceSessionId);
  });

  it("allows a new target operation after rollback and refuses reusing its operation id", async () => {
    const f = await transactionFixture();
    const first = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    vi.spyOn(f.manager, "waitForReady").mockRejectedValueOnce(new Error("startup failed"));
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(first.preview))).rejects.toMatchObject({ status: 409 });
    const next = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const request = f.commitRequest(next.preview, "operation-2");
    const result = await f.engine.commitHandoff(f.repo, "DEMO-1", request);
    expect(result.operation.stage).toBe("committed");
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", { ...request, reason: "another request" })).rejects.toMatchObject({ status: 409 });
    expect((await f.read()).handoffs).toHaveLength(2);
  });

  it.each(["prepared", "source-stopped", "target-created", "committed"])("does not perform the next side effect if the %s journal write fails", async (stage) => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const update = f.state.update.bind(f.state);
    let failed = false;
    vi.spyOn(f.state, "update").mockImplementation((change) =>
      update((s) => {
        change(s);
        if (!failed && s.runs[0]?.handoffs?.at(-1)?.stage === stage) {
          failed = true;
          throw new Error("disk full");
        }
      }),
    );
    const paste = vi.spyOn(f.manager, "paste");
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).rejects.toThrow();
    expect(failed).toBe(true);
    expect(paste).not.toHaveBeenCalled();
    const run = (await new StateStore(f.state.dir).load()).runs[0];
    expect(run.sessionId).toBe(preview.sourceSessionId);
    if (stage === "prepared") {
      expect(run.handoffs).toBeUndefined();
      expect((await f.manager.get(preview.sourceSessionId)).status).toBe("running");
    } else {
      expect(run.handoffs?.[0]).toMatchObject({ stage: "failed", cleanup: "complete" });
      if (stage === "source-stopped") {
        expect(run.handoffs![0].targetSessionId).toBeUndefined();
        expect(await f.manager.list(f.repo, "DEMO-1")).toHaveLength(1);
        expect((await f.manager.get(preview.sourceSessionId)).reservation).toBeUndefined();
      } else expect((await f.manager.get(run.handoffs![0].targetSessionId!)).status).toBe("exited");
    }
  });

  it.each(["sending", "sent"] as const)("keeps the durable target and never replays input when the %s checkpoint fails", async (point) => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const update = f.state.update.bind(f.state);
    let failed = false;
    vi.spyOn(f.state, "update").mockImplementation((change) =>
      update((draft) => {
        change(draft);
        if (!failed && draft.runs[0].handoffs?.at(-1)?.promptState === point) {
          failed = true;
          throw new Error("opaque-private-value disk failure");
        }
      }),
    );
    const paste = vi.spyOn(f.manager, "paste");
    const request = f.commitRequest(preview);
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", request)).rejects.toMatchObject({ status: 409 });
    expect(failed).toBe(true);
    const run = (await new StateStore(f.state.dir).load()).runs[0];
    const operation = run.handoffs![0];
    expect(operation).toMatchObject({ stage: "committed", promptState: point, cleanup: "complete" });
    expect(run).toMatchObject({ sessionId: operation.targetSessionId, phase: "interrupted", pendingPrompt: preview.prompt });
    expect((await f.manager.get(preview.sourceSessionId)).retired?.replacedBy).toBe(operation.targetSessionId);
    expect((await f.manager.get(operation.targetSessionId!)).status).toBe("exited");
    expect(paste).toHaveBeenCalledTimes(point === "sending" ? 0 : 1);
    const repeated = await f.engine.commitHandoff(f.repo, "DEMO-1", request);
    expect(repeated.operation).toEqual(operation);
    expect(paste).toHaveBeenCalledTimes(point === "sending" ? 0 : 1);
    expect(JSON.stringify(operation)).not.toContain("opaque-private-value");
  });

  it("rolls back a launch failure thrown by target create after its id was journaled", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const create = f.manager.create.bind(f.manager);
    vi.spyOn(f.manager, "create").mockImplementation((repo, task, options) => {
      f.faults.FAKE_CODEX_LAUNCH_FAIL = "codex cannot start";
      return create(repo, task, options);
    });
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).rejects.toMatchObject({ status: 409 });
    const operation = (await f.read()).handoffs![0];
    expect(operation).toMatchObject({ stage: "failed", cleanup: "complete" });
    expect(operation.targetSessionId).toBeTruthy();
    expect(await f.manager.get(operation.targetSessionId!)).toMatchObject({ status: "exited", retired: { replacedBy: preview.sourceSessionId } });
    expect((await f.read()).sessionId).toBe(preview.sourceSessionId);
  });

  it("does not replay a committed prompt after delivery fails and keeps manual retry on the target", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const paste = vi.spyOn(f.manager, "paste").mockImplementationOnce(() => {
      throw new Error("opaque-private-value paste failed");
    });
    const request = f.commitRequest(preview);
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", request)).rejects.toThrow("[REDACTED] paste failed");
    const run = await f.read();
    const operation = run.handoffs![0];
    expect(operation).toMatchObject({ stage: "committed", promptState: "sending", cleanup: "complete" });
    expect(run).toMatchObject({ phase: "interrupted", sessionId: operation.targetSessionId, pendingPrompt: preview.prompt });
    expect((await f.manager.get(preview.sourceSessionId)).retired?.replacedBy).toBe(operation.targetSessionId);
    expect((await f.engine.commitHandoff(f.repo, "DEMO-1", request)).operation).toEqual(operation);
    expect(paste).toHaveBeenCalledTimes(1);
    // Codex resumes by thread id and only its first hook names the thread; no prompt reached this target, so give it the id that hook would have.
    await seedCodexThread(f.repo, "target-thread");
    await f.state.update((draft) => {
      draft.sessions.find((s) => s.id === operation.targetSessionId)!.nativeId = "target-thread";
    });
    await f.engine.retry(f.repo, "DEMO-1");
    await vi.waitFor(() => expect(paste).toHaveBeenCalledTimes(2));
    expect(paste.mock.calls[1]).toEqual([operation.targetSessionId, preview.prompt]);
  });

  it("filters source prompt, last message and reason in every handoff copy before sending", async () => {
    const f = await transactionFixture("step", "Continue opaque-private-value");
    await f.state.update((state) => {
      state.runs[0].lastMessage = "Progress opaque-private-value";
    });
    f.request.reason = "Reason opaque-private-value";
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const paste = vi.spyOn(f.manager, "paste");
    const result = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    const state = await new StateStore(f.state.dir).load();
    const history = await readFile(path.join(f.repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8");
    const copies = [preview, result, state.runs[0].handoffPreviews, state.runs[0].handoffs, state.runs[0].sentPrompt, paste.mock.calls, history];
    for (const copy of copies) {
      expect(JSON.stringify(copy)).not.toContain("opaque-private-value");
      expect(JSON.stringify(copy)).toContain("[REDACTED]");
    }
  });

  it("permits an already exited source without stop consent", async () => {
    const f = await transactionFixture();
    const sourceId = (await f.read()).sessionId;
    await f.manager.stopAndWait(sourceId);
    await vi.waitFor(async () => expect((await f.read()).phase).toBe("interrupted"));
    const { preview, requiresConfirmation } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    expect(requiresConfirmation).toBe(false);
    const request = f.commitRequest(preview);
    delete request.confirmStop;
    expect((await f.engine.commitHandoff(f.repo, "DEMO-1", request)).operation.stage).toBe("committed");
  });

  it("allows only one of two distinct operations against the same preview", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const results = await Promise.allSettled([
      f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview, "one")),
      f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview, "two")),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((await f.read()).handoffs).toHaveLength(1);
    expect(await f.manager.list(f.repo, "DEMO-1")).toHaveLength(2);
  });

  it("returns to the run policy in the next step and never carries the lane override forward", async () => {
    const f = await transactionFixture();
    f.request.target = { agent: "copilot" };
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    const { operation } = await f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview));
    // A deliberate gate transition avoids done-when testing, which belongs to task 9.
    await f.state.update((state) => {
      state.runs[0].phase = "gate";
    });
    await f.engine.approve(f.repo, "DEMO-1");
    await vi.waitFor(async () => expect((await f.read()).stepIndex).toBe(1));
    const run = await f.read();
    expect((await f.manager.get(run.sessionId)).agent).toBe("codex");
    expect(run.sessionId).not.toBe(operation.targetSessionId);
    expect(Object.keys(run.laneOverrides!)).toEqual([laneKey(f.request.scope)]);
  });

  it("keeps source locked if target rollback cannot confirm exit", async () => {
    const f = await transactionFixture();
    const { preview } = await f.engine.previewHandoff(f.repo, "DEMO-1", f.request);
    vi.spyOn(f.manager, "waitForReady").mockRejectedValueOnce(new Error("startup failed"));
    vi.spyOn(f.manager, "rollback").mockRejectedValueOnce(new Error("target cleanup timeout"));
    await expect(f.engine.commitHandoff(f.repo, "DEMO-1", f.commitRequest(preview))).rejects.toMatchObject({ status: 409 });
    expect((await f.manager.get(preview.sourceSessionId)).reservation).toBeDefined();
    expect((await f.read()).handoffs![0].cleanup).toBe("blocked");
    await expect(f.engine.retry(f.repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("deterministic handoff builder", () => {
  it.each([undefined, "source context ".repeat(400)])("retains the current output schema when the source prompt is missing or truncated", (text) => {
    const input = fixture("step");
    input.run.sentPrompt = text === undefined ? undefined : { stepIndex: input.run.stepIndex, text, at: 2000 };
    input.workflow.steps[2].outputs[0].formatText = "# {{key}}\n\n## Phân công\n| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |\n";
    const preview = buildHandoff(input, safe);
    expect(preview.prompt).toContain("# TPL-032\n\n## Phân công");
    expect(preview.prompt).toContain("| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |");
    expect(preview.prompt).toBe(preview.text);
    expect(preview.prompt).not.toContain("unused template");
    const changed = structuredClone(input);
    changed.workflow.steps[2].outputs[0].formatText += "Changed contract";
    expect(buildHandoff(changed, safe).fingerprint).not.toBe(preview.fingerprint);
  });

  it("renders the member report schema and filters secrets in the new output contract", () => {
    const input = fixture();
    input.workflow.steps[1].dispatch!.formatText = "# {{key}}\n\n## Checks\nopaque-private-value";
    const preview = buildHandoff(input, createSafeText(["opaque-private-value"]));
    expect(preview.text).toContain("# TPL-032\n\n## Checks");
    expect(preview.text).not.toContain("opaque-private-value");
    expect(preview.text).toContain(REDACTED);
  });

  it("builds a scoped member snapshot with paths, unknowns and the last prompt actually sent", () => {
    const input = fixture();
    const preview = buildHandoff(input, safe);
    expect(preview.scope).toEqual(input.scope);
    expect(preview.sourceSessionId).toBe("member-2");
    expect(preview.expectedGeneration).toBe(3);
    expect(preview.source).toMatchObject({ agent: "claude", source: "assignment", modelSource: "default" });
    expect(preview.target).toMatchObject({ agent: "codex", source: "lane-override", modelSource: "default" });
    expect(preview.prompt).toBe(preview.text);
    expect(preview.text).toContain("Only this subtask 2");
    expect(preview.text).toContain("server/src/member-2.ts");
    expect(preview.text).toContain("Actually sent to 2");
    expect(preview.text).not.toContain("Actually sent to leader");
    expect(preview.text).not.toContain("unused template");
    expect(preview.text).not.toContain("unused dispatch");
    expect(preview.text).toContain("Unverified message 2");
    expect(preview.text).toContain("Dependencies: 1 (done)");
    expect(preview.text).toContain("Unknown: code changes, working tree state, build/test results");
    expect(preview.text).toContain("source may still be working");
    expect(preview.text).toContain("git status and diff");
    expect(preview.text).toContain("Viết tài liệu bằng tiếng Việt.");
    expect(preview.documents).toEqual([
      { kind: "spec", path: ".claude/tasks/TPL-032/spec", status: "unknown", required: false },
      { kind: "history", path: ".claude/tasks/TPL-032/00-history.md", status: "unknown", required: false },
      { kind: "approved-plan", path: ".claude/tasks/TPL-032/02-plan.md", status: "present", required: false },
      { kind: "dependency-report", path: ".claude/tasks/TPL-032/03-viec-1.md", status: "unknown", required: false },
      { kind: "output", path: ".claude/tasks/TPL-032/03-viec-2.md", status: "missing", required: true },
    ]);
  });

  it("supports the main lane without claiming code/checks are complete or rerunning done work", () => {
    const preview = buildHandoff(fixture("step"), safe);
    expect(preview.sourceSessionId).toBe("leader-session");
    expect(preview.text).toContain("Only this step; step 3/3: Review");
    expect(preview.text).toContain("Actually sent to leader");
    expect(preview.text).toContain("Claimed code complete, no report checked");
    expect(preview.text).toContain("not proof of completion");
    expect(preview.text).toContain("marked done by the engine (not code/test verification): 1: Work 1");
    expect(preview.documents.at(-1)).toMatchObject({ path: ".claude/tasks/TPL-032/04-summary.md", required: true, status: "unknown" });
    expect(preview.text).toContain("Do not restart/archive the task or rerun completed subtasks");
  });

  it("is reproducible and never mutates inputs, even when inputs and arrays are frozen", () => {
    const input = fixture();
    const before = structuredClone(input);
    const freeze = (value: unknown) => {
      if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    };
    freeze(input);
    const first = buildHandoff(input, safe);
    const second = buildHandoff(input, safe);
    expect(first).toEqual(second);
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.text).toContain(first.fingerprint);
    expect(input).toEqual(before);
    first.scope.stepId = "changed";
    expect(input.scope.stepId).toBe("work");
  });

  it("never copies unlisted state, env, config, transcript, tools, native ids or dependency text", () => {
    const input = fixture();
    const forbidden = "UNLISTED_PRIVATE_DATA";
    Object.assign(input, { env: { API_KEY: forbidden }, transcript: forbidden });
    Object.assign(input.run, { env: forbidden, rawToolOutput: forbidden, nativeThreadId: forbidden, pendingPrompt: forbidden });
    Object.assign(input.workflow, { rawConfig: forbidden });
    input.run.subtasks![0].lastMessage = forbidden;
    input.workflow.steps[0].prompt = forbidden;
    input.run.subtasks![1].pendingPrompt = forbidden;
    input.run.subtasks![2].lastMessage = forbidden;
    const serialized = JSON.stringify(buildHandoff(input, safe));
    expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain("nativeThreadId");
    expect(serialized).not.toContain("rawToolOutput");
  });

  it("redacts every output field before API, journal/state, history and prompt copies", () => {
    const input = fixture("step");
    const secret = "opaque-internal-private-value";
    const pattern = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz";
    const unsafe = `${secret}\n${pattern}\nAuthorization: Bearer header-private\npassword='quoted-private'`;
    input.task.title = unsafe;
    input.reason = unsafe;
    input.run.message = unsafe;
    input.run.lastMessage = unsafe;
    input.run.sentPrompt!.text = unsafe;
    input.run.subtasks![0].title = unsafe;
    const preview = buildHandoff(input, createSafeText([secret]));
    const destinations = [
      JSON.stringify(preview),
      JSON.stringify({ handoffs: [{ text: preview.text, reason: preview.reason, fingerprint: preview.fingerprint }] }),
      `history\n${preview.text}\n${preview.reason}`,
      preview.prompt,
    ];
    for (const destination of destinations) {
      for (const credential of [secret, pattern, "header-private", "quoted-private"]) expect(destination).not.toContain(credential);
      expect(destination).toContain(REDACTED);
    }
    expect(preview.documents).toContainEqual({ kind: "input", path: ".claude/tasks/TPL-032/02-plan.md", status: "present", required: false });
    expect(input.run.sentPrompt!.text).toBe(unsafe); // Source history is not rewritten.
  });

  it.each(["sentPrompt", "lastMessage", "reason", "message"] as const)("omits unsafe oversized %s content and keeps paths and next actions", (field) => {
    const input = fixture("step");
    const unsafe = "UNSAFE_BODY" + "x".repeat(256_000);
    if (field === "sentPrompt") input.run.sentPrompt!.text = unsafe;
    else if (field === "reason") input.reason = unsafe;
    else input.run[field] = unsafe;
    const preview = buildHandoff(input, safe);
    expect(preview.prompt).toContain("[OMITTED: text exceeds the safe input limit]");
    expect(preview.prompt).not.toContain("UNSAFE_BODY");
    expect(preview.prompt).toContain(".claude/tasks/TPL-032/04-summary.md");
    expect(preview.prompt).toContain("git status and diff");
  });

  it("does not copy a prompt from another step, pending prompt, or invent missing source context", () => {
    const input = fixture("step");
    input.run.sentPrompt!.stepIndex = 0;
    input.run.pendingPrompt = "not actually sent";
    delete input.run.lastMessage;
    const preview = buildHandoff(input, safe);
    expect(preview.text).not.toContain("Actually sent to leader");
    expect(preview.text).not.toContain("not actually sent");
    expect(preview.text).toContain("Unknown: no recorded text");
  });

  it("omits ambiguous sensitive excerpts while retaining document paths and continuation instructions", () => {
    const input = fixture();
    input.run.subtasks![1].lastMessage = "password: |\n  PRIVATE_BLOCK\n  PRIVATE_TAIL";
    const preview = buildHandoff(input, safe);
    expect(preview.text).toContain("[OMITTED: credential content cannot be safely separated]");
    expect(preview.text).not.toContain("PRIVATE_BLOCK");
    expect(preview.text).not.toContain("PRIVATE_TAIL");
    expect(preview.text).toContain(".claude/tasks/TPL-032/03-viec-2.md");
    expect(preview.text).toContain("Check git status and diff before editing");
  });

  it("keeps file presence unknown when observations conflict; present output stays required", () => {
    const input = fixture();
    const file = ".claude/tasks/TPL-032/03-viec-2.md";
    input.files = [
      { path: file, status: "present" },
      { path: file, status: "missing" },
    ];
    expect(buildHandoff(input, safe).documents.at(-1)).toMatchObject({ status: "unknown", required: true });
    input.files = [{ path: file, status: "present" }];
    expect(buildHandoff(input, safe).documents.at(-1)).toMatchObject({ status: "present", required: true });
  });

  it.each(["../outside.md", "/etc/passwd", "C:\\outside.md", "\\\\host\\share", "a/../../outside.md", "https://private.test/secret", "line\nbreak.md", "`tool`.md"])(
    "omits unsafe path %s without reading it",
    (file) => {
      const input = fixture();
      input.workflow.history.file = file;
      input.run.subtasks![1].report = file;
      input.run.subtasks![1].files = [file];
      const preview = buildHandoff(input, safe);
      expect(preview.documents.filter((d) => d.status === "omitted")).toHaveLength(2);
      expect(preview.text).not.toContain(file);
      expect(preview.text).toContain("[OMITTED: unsafe path]");
      expect(preview.text).toContain("[OMITTED: unsafe file path]");
    },
  );

  it("omits secret-bearing paths and retains safe document paths", () => {
    const input = fixture();
    input.run.subtasks![1].report = "private-name.md";
    input.run.subtasks![1].files = ["server/private-name.ts", "server/public.ts"];
    const preview = buildHandoff(input, createSafeText(["private-name"]));
    expect(JSON.stringify(preview)).not.toContain("private-name");
    expect(preview.documents.at(-1)).toEqual({ kind: "output", status: "omitted", required: true });
    expect(preview.text).toContain("server/public.ts");
    expect(preview.text).toContain(".claude/tasks/TPL-032/02-plan.md");
  });

  it("normalizes relative Windows file scope paths without touching the filesystem", () => {
    const input = fixture();
    input.run.subtasks![1].files = ["server\\src\\file.ts"];
    expect(buildHandoff(input, safe).text).toContain("server/src/file.ts");
  });

  it("records missing dependency metadata honestly", () => {
    const input = fixture();
    input.run.subtasks![1].deps = [99];
    const preview = buildHandoff(input, safe);
    expect(preview.text).toContain("Dependencies: 99 (unknown)");
    expect(preview.documents).toContainEqual({ kind: "dependency-report", path: ".claude/tasks/TPL-032/03-viec-99.md", status: "unknown", required: false });
  });

  it("uses effective run and lane policies, while preserving the original workflow and other lanes", () => {
    const input = fixture("step");
    input.run.execution = { agent: "codex", model: "gpt-6.1-sol" };
    input.run.laneOverrides = { [laneKey(input.scope)]: { scope: input.scope, execution: { agent: "copilot" }, operationId: "prior-transfer", at: 1_000 } };
    const before = structuredClone(input);
    const preview = buildHandoff(input, safe);
    expect(preview.source).toMatchObject({ agent: "copilot", source: "lane-override" });
    expect(preview.target.agent).toBe("codex");
    expect(preview.target.model).toBeUndefined();
    expect(input).toEqual(before);
  });

  it("blocks incompatible permissions/subagents and never leaks offending configuration in errors", () => {
    const input = fixture();
    input.workflow.permissionMode = "plan";
    expect(() => buildHandoff(input, safe)).toThrow("incompatible-execution");
    input.workflow.permissionMode = "default";
    input.run.subtasks![1].subagent = "restricted-member";
    expect(() => buildHandoff(input, safe)).toThrow("incompatible-execution");
    input.target = { agent: "claude" };
    expect(buildHandoff(input, safe).target).toMatchObject({ subagent: "restricted-member", permissionMode: "default" });
    input.target = { agent: "codex", model: "password=private-invalid-model" };
    expect(() => buildHandoff(input, safe)).toThrow("Cannot build handoff: incompatible-execution");
  });

  it.each(["task", "step", "session", "model", "permission"])("fails closed for secret-bearing %s identity/configuration", (field) => {
    const input = fixture();
    if (field === "task") input.task.key = input.run.taskKey = "private-identity";
    if (field === "step") input.scope.stepId = input.workflow.steps[1].id = "private-identity";
    if (field === "session") input.run.subtasks![1].sessionId = "private-identity";
    if (field === "model") input.target.model = "private-identity";
    if (field === "permission") input.workflow.permissionMode = "private-identity";
    expect(() => buildHandoff(input, createSafeText(["private-identity"]))).toThrow("Cannot build handoff: unsafe-identity");
  });

  it.each(["done", "cancelled", "gate"] as const)("refuses run phase %s", (phase) => {
    const input = fixture();
    input.run.phase = phase;
    expect(() => buildHandoff(input, safe)).toThrow("inactive-lane");
  });

  it.each(["done", "pending"] as const)("refuses member phase %s", (phase) => {
    const input = fixture();
    input.run.subtasks![1].phase = phase;
    expect(() => buildHandoff(input, safe)).toThrow("inactive-lane");
  });

  it.each(["starting", "running", "waiting", "interrupted"] as const)("allows started lane phase %s without performing any lifecycle action", (phase) => {
    const input = fixture();
    input.run.subtasks![1].phase = phase;
    expect(buildHandoff(input, safe).text).toContain(`Phase recorded by TaskPilot: ${phase}`);
  });

  it("refuses unstarted members, stale scope and the synthetic dispatch leader", () => {
    const input = fixture();
    delete input.run.subtasks![1].sessionId;
    expect(() => buildHandoff(input, safe)).toThrow("inactive-lane");
    input.scope.stepId = "plan";
    expect(() => buildHandoff(input, safe)).toThrow("inactive-lane");
    input.scope = { kind: "step", stepId: "work" };
    expect(() => buildHandoff(input, safe)).toThrow("inactive-lane");
  });

  it("refuses invalid metadata and oversized snapshots with fixed safe diagnostics", () => {
    for (const patch of [{ generation: -1 }, { createdAt: Number.NaN }, { task: { key: "../outside", title: "title" } }]) {
      expect(() => buildHandoff({ ...fixture(), ...patch }, safe)).toThrow("invalid-input");
    }
    const input = fixture();
    input.run.subtasks![1].files = Array(201).fill("path.ts");
    expect(() => buildHandoff(input, safe)).toThrow(HandoffBuildError);
    expect(() => buildHandoff(input, safe)).toThrow("too-large");
    input.run.subtasks![1].files = Array.from({ length: 200 }, (_, i) => `${"p".repeat(400)}/${i}`);
    expect(() => buildHandoff(input, safe)).toThrow("too-large");
  });
});

describe("lane fingerprint and preview identity", () => {
  it.each(["session", "generation", "prompt", "promptTime", "message", "phase", "files", "report", "dependency", "execution", "attempt", "newRun"])(
    "invalidates the lane fingerprint on %s change",
    (field) => {
      const input = fixture();
      const before = buildHandoff(input, safe);
      const sub = input.run.subtasks![1];
      if (field === "session") sub.sessionId = "new-session";
      if (field === "generation") input.generation++;
      if (field === "prompt") sub.sentPrompt!.text += "changed";
      if (field === "promptTime") sub.sentPrompt!.at++;
      if (field === "message") sub.lastMessage += "changed";
      if (field === "phase") sub.phase = "waiting";
      if (field === "files") sub.files.push("new.ts");
      if (field === "report") sub.report = "different.md";
      if (field === "dependency") input.run.subtasks![0].phase = "interrupted";
      if (field === "execution") sub.model = "sonnet";
      if (field === "attempt") input.run.attempts = [{ id: "attempt-2", scope: input.scope, sessionId: sub.sessionId!, generation: 3, execution: before.source, startedAt: 2_000 }];
      if (field === "newRun") input.run.startedAt++;
      expect(buildHandoff(input, safe).fingerprint).not.toBe(before.fingerprint);
    },
  );

  it("fingerprints full relevant source text, even if both previews redact or truncate the difference", () => {
    const input = fixture();
    const safe = createSafeText(["private-one", "private-two"]);
    input.run.subtasks![1].lastMessage = "private-one";
    const first = buildHandoff(input, safe);
    input.run.subtasks![1].lastMessage = "private-two";
    expect(buildHandoff(input, safe).fingerprint).not.toBe(first.fingerprint);
    input.run.subtasks![1].lastMessage = "x".repeat(5_000) + "a";
    const long = buildHandoff(input, safe);
    input.run.subtasks![1].lastMessage = "x".repeat(5_000) + "b";
    expect(buildHandoff(input, safe).fingerprint).not.toBe(long.fingerprint);
  });

  it("ignores other lanes' progress and the aggregate run update for a member lane", () => {
    const input = fixture();
    const first = buildHandoff(input, safe);
    input.run.updatedAt++;
    input.run.message = "Another member finished";
    input.run.lastMessage = "Other leader message";
    input.run.phase = "waiting";
    input.run.subtasks![2].phase = "done";
    input.run.subtasks![2].lastMessage = "unrelated new message";
    const next = buildHandoff(input, safe);
    expect(next.fingerprint).toBe(first.fingerprint);
    expect(next.id).not.toBe(first.id); // Preview content is a separate snapshot.
  });

  it("binds preview identity to target, reason, timestamp, sanitization and file observations", () => {
    const input = fixture();
    const first = buildHandoff(input, safe);
    const variants = [
      { ...input, target: { agent: "copilot" as const } },
      { ...input, reason: "User requested another CLI" },
      { ...input, createdAt: input.createdAt + 1 },
      { ...input, files: [] },
    ];
    for (const variant of variants) {
      const preview = buildHandoff(variant, safe);
      expect(preview.id).not.toBe(first.id);
      expect(preview.fingerprint).toBe(first.fingerprint);
    }
    expect(buildHandoff(input, createSafeText(["Continue work"])).id).not.toBe(first.id);
  });

  it("is stable across JSON reload and object property order", () => {
    const input = fixture();
    const reloaded = JSON.parse(JSON.stringify(input)) as BuildHandoffInput;
    reloaded.scope = { stepId: "work", n: 2, kind: "subtask" };
    expect(buildHandoff(reloaded, safe)).toEqual(buildHandoff(input, safe));
  });
});
