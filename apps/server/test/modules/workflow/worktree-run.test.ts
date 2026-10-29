import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../../../src/core/state.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import type { SessionPort } from "../../../src/modules/workflow/ports.js";
import type { PreflightRequest } from "../../../src/modules/sessions/preflight.js";
import type { SessionCreateOptions } from "../../../src/modules/sessions/manager.js";
import type { SessionView } from "../../../src/modules/sessions/types.js";
import { readTaskStatus } from "../../../src/modules/tasks/status.js";
import { WorktreeConflict, WorktreeManager } from "../../../src/modules/workspace/index.js";
import { gitSync, makeGitRepo } from "../../helpers/git-repo.js";

let dir: string;
let repo: string;
let state: StateStore;
let worktrees: WorktreeManager;
let engine: WorkflowEngine;
let sessions: Map<string, SessionView>;
let created: Array<{ id: string; opts: SessionCreateOptions }>;
let pasted: Array<{ id: string; text: string }>;
let preflights: Array<{ request: PreflightRequest; cwd?: string }>;
let quiesced: string[];
let stopped: string[];

const taskDir = (key: string) => path.join(repo, ".claude", "tasks", key);
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "tpl025 engine ")));
  repo = await makeGitRepo(path.join(dir, "repo"));
  await mkdir(path.join(taskDir("DEMO-2"), "spec"), { recursive: true });
  await writeFile(path.join(taskDir("DEMO-2"), "spec", "context.md"), "# Demo 2\n");
  state = new StateStore(path.join(dir, "state"));
  worktrees = new WorktreeManager(state);
  sessions = new Map();
  created = [];
  pasted = [];
  preflights = [];
  quiesced = [];
  stopped = [];
  let next = 0;
  const port: SessionPort = {
    create: async (r, taskKey, opts) => {
      const id = `s${++next}`;
      created.push({ id, opts });
      const view: SessionView = {
        id,
        repo: r,
        taskKey,
        title: id,
        createdAt: Date.now(),
        agent: opts.agent ?? "claude",
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.subagent ? { subagent: opts.subagent } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.extraDirs ? { extraDirs: opts.extraDirs } : {}),
        ...(opts.runId ? { runId: opts.runId } : {}),
        generation: 1,
        status: "running",
        exitCode: null,
        activity: "idle",
      };
      sessions.set(id, view);
      await opts.beforeSpawn?.(view);
      return view;
    },
    get: async (id) => {
      const view = sessions.get(id);
      if (!view) throw new Error(`no session ${id}`);
      return view;
    },
    resume: async (id) => sessions.get(id)!,
    stop: async (id) => {
      stopped.push(id);
      sessions.get(id)!.status = "exited";
    },
    paste: (id, text) => void pasted.push({ id, text }),
    hookSeen: () => true,
    preflight: async (_repo, request, opts) => {
      preflights.push({ request, cwd: opts?.cwd });
      return { status: "ready", configuration: request, capability: {} as never, model: { status: "unknown", source: "unverified" }, errors: [] };
    },
    reserve: async (id, operationId, role = "source") => {
      const view = sessions.get(id)!;
      view.reservation = { operationId, role, at: Date.now() };
      return view;
    },
    release: async (id) => {
      const view = sessions.get(id)!;
      delete view.reservation;
      return view;
    },
    retire: async (id, operationId, replacedBy) => {
      const view = sessions.get(id)!;
      view.retired = { operationId, replacedBy, at: Date.now() };
      delete view.reservation;
      return view;
    },
    waitForReady: async (id) => sessions.get(id)!,
    waitForExit: async () => {},
    stopAndWait: async (id) => {
      stopped.push(id);
      sessions.get(id)!.status = "exited";
    },
    recoverProcess: async () => {},
    rollback: async () => {},
    quiesce: async (cwd) => {
      if ([...sessions.values()].some((s) => s.cwd === cwd && s.status === "running")) throw new Error("still running");
      quiesced.push(cwd);
    },
  };
  engine = new WorkflowEngine(state, port, undefined, undefined, undefined, undefined, worktrees);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("runs every session of a worktree run in its worktree, with absolute task paths in the prompt", async () => {
  const run = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
  const workspace = (await worktrees.get(run.runId!))!;
  expect(run.workspace).toEqual({ path: workspace.path, cwd: workspace.cwd, branch: workspace.branch });
  expect(created[0].opts).toMatchObject({ cwd: workspace.cwd, extraDirs: [taskDir("DEMO-1")], runId: run.runId });
  // Preflight ran again where the session runs: subagent files are read in the worktree.
  expect(preflights.some((p) => p.cwd === workspace.cwd)).toBe(true);
  const prompt = pasted[0].text;
  expect(prompt).toContain(`${taskDir("DEMO-1")}/02-plan.md`);
  expect(prompt).toContain(`Git worktree riêng \`${workspace.cwd}\``);
  expect(prompt).not.toMatch(/`\.claude\/tasks\/DEMO-1/);
  const history = await readFile(path.join(taskDir("DEMO-1"), "00-history.md"), "utf8");
  expect(history).toContain(`Run chạy trong worktree riêng: ${workspace.path}`);

  // A second task's run gets its own worktree; the repo stays untouched.
  const other = await engine.start(repo, "DEMO-2", { isolation: "worktree" });
  expect(other.workspace!.cwd).not.toBe(workspace.cwd);
  expect(gitSync(repo, "status", "--porcelain")).toBe("");
});

it("keeps a run in the repo unless the worktree is chosen, with a run id all the same", async () => {
  const run = await engine.start(repo, "DEMO-1");
  expect(run.runId).toBeTruthy();
  expect(run.workspace).toBeUndefined();
  expect(created[0].opts.cwd).toBeUndefined();
  expect(created[0].opts.extraDirs).toBeUndefined();
  expect(pasted[0].text).toContain("`.claude/tasks/DEMO-1/02-plan.md`");
  expect(pasted[0].text).not.toContain("Git worktree riêng");
  expect(await worktrees.list(repo, "DEMO-1")).toEqual([]);
});

it("refuses a dirty repo without the user's consent and creates nothing", async () => {
  await writeFile(path.join(repo, "src", "app.txt"), "uncommitted\n");
  const refused = await engine.start(repo, "DEMO-1", { isolation: "worktree" }).catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(WorktreeConflict);
  expect((refused as WorktreeConflict).files).toEqual(["src/app.txt"]);
  expect(created).toHaveLength(0);
  expect((await state.load()).runs).toHaveLength(0);
  expect(await worktrees.list(repo, "DEMO-1")).toEqual([]);

  const run = await engine.start(repo, "DEMO-1", { isolation: "worktree", acceptDirtyBase: true });
  expect((await worktrees.get(run.runId!))!.dirtyBaseAccepted).toEqual(["src/app.txt"]);
  expect(await readFile(path.join(run.workspace!.cwd, "src", "app.txt"), "utf8")).toBe("line 1\nline 2\n");
});

it("marks a worktree run done without marking the task done until its branch is integrated", async () => {
  const run = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  await writeFile(path.join(run.workspace!.cwd, "src", "app.txt"), "line 1\nline 2\nfrom the run\n");
  await state.update((s) => {
    const saved = s.runs.find((r) => r.taskKey === "DEMO-1")!;
    saved.stepIndex = 1;
    saved.phase = "gate";
  });
  const done = await engine.approve(repo, "DEMO-1");
  expect(done.phase).toBe("done");
  expect(await readTaskStatus(taskDir("DEMO-1"))).toMatchObject({ status: "open" });
  expect(await readFile(path.join(taskDir("DEMO-1"), "00-history.md"), "utf8")).toContain("chờ ba bấm Tích hợp");

  // Uncommitted run work needs the user's go-ahead for TaskPilot's commit.
  await expect(engine.integrateWorkspace(repo, "DEMO-1", run.runId!)).rejects.toBeInstanceOf(WorktreeConflict);
  const view = await engine.integrateWorkspace(repo, "DEMO-1", run.runId!, { commit: true });
  expect(view.integration.status).toBe("integrated");
  expect(await readFile(path.join(repo, "src", "app.txt"), "utf8")).toContain("from the run");
  expect(await readTaskStatus(taskDir("DEMO-1"))).toMatchObject({ status: "done" });
});

it("refuses integrate and cleanup while the run is active; cleanup waits for its sessions to stop", async () => {
  const run = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  await expect(engine.integrateWorkspace(repo, "DEMO-1", run.runId!, { commit: true })).rejects.toMatchObject({ status: 409 });
  await expect(engine.removeWorkspace(repo, "DEMO-1", run.runId!)).rejects.toMatchObject({ status: 409 });

  await engine.cancel(repo, "DEMO-1");
  // The run is cancelled but its session still runs in the worktree: the barrier refuses.
  await expect(engine.removeWorkspace(repo, "DEMO-1", run.runId!)).rejects.toMatchObject({ status: 409 });
  expect(await exists(run.workspace!.path)).toBe(true);
  // Cancel keeps the worktree record for reconciliation.
  expect((await engine.workspaces(repo, "DEMO-1"))[0]).toMatchObject({ runId: run.runId, active: false });

  sessions.get(run.sessionId)!.status = "exited";
  const removed = await engine.removeWorkspace(repo, "DEMO-1", run.runId!);
  expect(quiesced).toEqual([run.workspace!.cwd]);
  expect(removed.removedAt).toBeTypeOf("number");
  expect(await exists(run.workspace!.path)).toBe(false);
});

it("gives a restart a new run id and worktree, keeping the old worktree and its record", async () => {
  const first = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  await writeFile(path.join(first.workspace!.cwd, "src", "app.txt"), "first run work\n");
  const second = await engine.restart(repo, "DEMO-1", { isolation: "worktree" });
  expect(second.runId).not.toBe(first.runId);
  expect(second.workspace!.cwd).not.toBe(first.workspace!.cwd);
  expect(stopped).toContain(first.sessionId);
  const records = await engine.workspaces(repo, "DEMO-1");
  expect(records.map((w) => w.runId).sort()).toEqual([first.runId, second.runId].sort());
  expect(records.find((w) => w.runId === first.runId)!.changes).toEqual(["src/app.txt"]);
  expect(created.at(-1)!.opts).toMatchObject({ cwd: second.workspace!.cwd, runId: second.runId });
});

it("leaves the current run alone when a restart cannot make its worktree", async () => {
  const first = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  await writeFile(path.join(repo, "dirty.txt"), "x\n");
  await expect(engine.restart(repo, "DEMO-1", { isolation: "worktree" })).rejects.toBeInstanceOf(WorktreeConflict);
  const kept = (await state.load()).runs.find((r) => r.taskKey === "DEMO-1")!;
  expect(kept.runId).toBe(first.runId);
  expect(stopped).toEqual([]);
  expect(await exists(path.join(taskDir("DEMO-1"), "archive"))).toBe(false);
});

it("hands a lane over to a new session in the same worktree, and refuses a source from another tree", async () => {
  const run = await engine.start(repo, "DEMO-1", { isolation: "worktree" });
  const request = { scope: { kind: "step" as const, stepId: "investigate" }, target: { agent: "claude" as const, model: "opus" } };
  const { preview } = await engine.previewHandoff(repo, "DEMO-1", request);
  expect(preview.text).toContain(`own Git worktree ${run.workspace!.cwd}`);
  await engine.commitHandoff(repo, "DEMO-1", {
    ...request,
    previewId: preview.id,
    fingerprint: preview.fingerprint,
    sourceSessionId: preview.sourceSessionId,
    expectedGeneration: preview.expectedGeneration,
    operationId: "op-1",
    confirmStop: true,
  });
  const target = created.at(-1)!;
  expect(target.id).not.toBe(run.sessionId);
  expect(target.opts).toMatchObject({ cwd: run.workspace!.cwd, extraDirs: [taskDir("DEMO-1")], runId: run.runId, operationId: "op-1" });
  const saved = (await state.load()).runs.find((r) => r.taskKey === "DEMO-1")!;
  expect(saved.sessionId).toBe(target.id);
  expect(saved.runId).toBe(run.runId);

  // A source session that runs outside the run's worktree is not this run's lane.
  sessions.get(target.id)!.cwd = path.join(dir, "elsewhere");
  await expect(engine.previewHandoff(repo, "DEMO-1", request)).rejects.toMatchObject({ status: 409 });
});
