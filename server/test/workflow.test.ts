import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../src/sessions/manager.js";
import { hookSettings, HOOK_EVENTS } from "../src/sessions/hooks.js";
import type { SessionMeta } from "../src/state.js";
import { StateStore } from "../src/state.js";
import { loadWorkflow, parseWorkflow, render, DEFAULT_WORKFLOW_DIR } from "../src/workflow/definition.js";
import { WorkflowEngine, type SessionPort } from "../src/workflow/engine.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

afterAll(cleanupTempDirs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("workflow definition", () => {
  it("loads the built-in workflow with its prompts", async () => {
    const def = await loadWorkflow(await makeRepo());
    expect(def.source).toBe(path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml"));
    expect(def.steps.map((s) => [s.id, s.gate, s.doneWhen?.file])).toEqual([
      ["investigate", "approve", "02-plan.md"],
      ["implement", "approve", "04-summary.md"],
    ]);
    expect(def.steps[0].prompt).toContain("{{specDir}}");
    expect(def.steps[0].onReject).toContain("{{feedback}}");
  });

  it("prefers .claude/workflow.yml and falls back to default prompts", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, ".claude", "custom.md"), "Custom {{key}}");
    await writeFile(
      path.join(repo, ".claude", "workflow.yml"),
      "permission-mode: acceptEdits\nsteps:\n  - id: one\n    prompt: custom.md\n  - id: two\n    prompt: implement.md\n",
    );
    const def = await loadWorkflow(repo);
    expect(def.permissionMode).toBe("acceptEdits");
    expect(def.steps[0]).toMatchObject({ id: "one", title: "one", gate: "none", prompt: "Custom {{key}}" });
    expect(def.steps[1].prompt).toContain("approved");
  });

  it.each([
    ["steps: []", "non-empty"],
    ["permission-mode: bypassPermissions\nsteps:\n  - {id: a, prompt: implement.md}", "permission-mode"],
    ["steps:\n  - {id: a, prompt: implement.md}\n  - {id: a, prompt: implement.md}", "duplicate"],
    ["steps:\n  - {id: a, prompt: ../../etc/passwd}", "relative"],
    ["steps:\n  - {id: a, prompt: missing.md}", "not found"],
    ["steps:\n  - {id: a, prompt: implement.md, gate: maybe}", "gate"],
  ])("rejects %j", async (yaml, message) => {
    const dir = await tempDir("taskpilot-wf-");
    await writeFile(path.join(dir, "workflow.yml"), yaml);
    await expect(parseWorkflow(path.join(dir, "workflow.yml"), [dir, DEFAULT_WORKFLOW_DIR])).rejects.toThrow(message);
  });

  it("renders known variables and leaves unknown ones visible", () => {
    expect(render("{{key}} {{nope}}", { key: "A-1" })).toBe("A-1 {{nope}}");
  });

  it("injects every hook through curl with the session's env", () => {
    const settings = JSON.parse(hookSettings()) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });
});

/** In-memory SessionPort recording pasted prompts. */
class FakeSessions implements SessionPort {
  sessions = new Map<string, SessionView>();
  pasted: string[] = [];
  resumed: string[] = [];
  constructor(private readonly state: StateStore) {}

  async create(repo: string, taskKey: string, opts: { permissionMode?: string }): Promise<SessionView> {
    const id = `00000000-0000-4000-8000-${String(this.sessions.size).padStart(12, "0")}`;
    const meta: SessionMeta = { id, repo, taskKey, title: "Session", createdAt: Date.now(), ...opts };
    await this.state.update((s) => void s.sessions.push(meta));
    const view: SessionView = { ...meta, status: "running", exitCode: null, activity: "starting" };
    this.sessions.set(id, view);
    return view;
  }
  async resume(id: string) {
    this.resumed.push(id);
    return Object.assign(this.sessions.get(id)!, { status: "running" as const, activity: "starting" as const });
  }
  async get(id: string) {
    return this.sessions.get(id)!;
  }
  paste(id: string, text: string) {
    this.pasted.push(text);
    this.sessions.get(id)!.activity = "busy";
  }
  meta(id: string): SessionMeta {
    return this.sessions.get(id)!;
  }
  exit(id: string) {
    Object.assign(this.sessions.get(id)!, { status: "exited", activity: null });
  }
}

describe("workflow engine", () => {
  let repo: string;
  let fake: FakeSessions;
  let engine: WorkflowEngine;
  let state: StateStore;
  const taskDir = () => path.join(repo, ".claude", "tasks", "DEMO-1");

  /** Writes a task file, as Claude would during the current step. */
  async function write(name: string) {
    await mkdir(taskDir(), { recursive: true });
    await writeFile(path.join(taskDir(), name), "# x\n");
  }

  async function hook(event: Parameters<WorkflowEngine["onHook"]>[1]) {
    const run = (await state.load()).runs[0];
    fake.sessions.get(run.sessionId)!.activity = event === "Stop" || event === "SessionStart" ? "idle" : "busy";
    await engine.onHook(fake.meta(run.sessionId), event);
    return (await state.load()).runs[0];
  }

  beforeEach(async () => {
    repo = await makeRepo();
    state = new StateStore(await tempDir("taskpilot-state-"));
    fake = new FakeSessions(state);
    engine = new WorkflowEngine(state, fake);
    // The fixture's 02-plan.md predates every run.
    const past = new Date("2020-01-01");
    await utimes(path.join(taskDir(), "02-plan.md"), past, past);
  });

  it("runs investigate → gate → feedback → gate → implement → done", async () => {
    const run = await engine.start(repo, "DEMO-1");
    expect(run).toMatchObject({ phase: "starting", stepIndex: 0 });
    expect(fake.pasted).toEqual([]);

    expect(await hook("SessionStart")).toMatchObject({ phase: "running" });
    expect(fake.pasted[0]).toContain("task DEMO-1: \"Health endpoint\"");
    expect(fake.pasted[0]).toContain(".claude/tasks/DEMO-1/spec/");

    // The fixture already has an old 02-plan.md; it must be rewritten during the step.
    expect(await hook("Stop")).toMatchObject({ phase: "waiting" });
    await hook("UserPromptSubmit");
    await write("02-plan.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate" });

    // Outside the engine's mtime slack, so the plan above does not count for the next prompt.
    await sleep(150);
    await engine.feedback(repo, "DEMO-1", "Cover the error case");
    expect(fake.pasted[1]).toContain("Cover the error case");
    expect(await hook("Stop")).toMatchObject({ phase: "waiting" });
    await write("02-plan.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate" });

    await engine.approve(repo, "DEMO-1");
    expect(fake.pasted[2]).toContain("is approved");
    await write("04-summary.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate", stepIndex: 1 });
    expect(await engine.approve(repo, "DEMO-1")).toMatchObject({ phase: "done" });
  });

  it("resumes an exited session on retry and sends the step again after SessionStart", async () => {
    const run = await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    fake.exit(run.sessionId);
    await engine.onExit(fake.meta(run.sessionId));
    expect((await state.load()).runs[0]).toMatchObject({ phase: "interrupted" });

    await engine.retry(repo, "DEMO-1");
    expect(fake.resumed).toEqual([run.sessionId]);
    expect((await state.load()).runs[0]).toMatchObject({ phase: "starting" });
    expect(await hook("SessionStart")).toMatchObject({ phase: "running" });
    expect(fake.pasted).toHaveLength(2);
  });

  it("refuses a second active run and allows one after cancel", async () => {
    await engine.start(repo, "DEMO-1");
    await expect(engine.start(repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await engine.cancel(repo, "DEMO-1");
    await expect(engine.start(repo, "DEMO-1")).resolves.toMatchObject({ phase: "starting" });
  });

  it("refuses approve outside a gate and retry while Claude is busy", async () => {
    await engine.start(repo, "DEMO-1");
    await expect(engine.approve(repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await hook("SessionStart");
    await expect(engine.retry(repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
  });

  it("marks active runs interrupted after a restart", async () => {
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    await new WorkflowEngine(state, fake).recover();
    expect((await state.load()).runs[0]).toMatchObject({ phase: "interrupted" });
  });
});
