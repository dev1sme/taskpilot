import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../../../src/modules/sessions/manager.js";
import type { SessionMeta } from "../../../src/core/state.js";
import { StateStore } from "../../../src/core/state.js";
import type { Agent } from "../../../src/core/agents.js";
import { loadWorkflow } from "../../../src/modules/workflow/definition.js";
import { WorkflowEngine, type SessionPort } from "../../../src/modules/workflow/engine.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const HISTORY_FILE = "00-history.md";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory SessionPort recording pasted prompts. */
class FakeSessions implements SessionPort {
  sessions = new Map<string, SessionView>();
  pasted: string[] = [];
  resumed: string[] = [];
  constructor(private readonly state: StateStore) {}

  async create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent }): Promise<SessionView> {
    const id = `00000000-0000-4000-8000-${String(this.sessions.size).padStart(12, "0")}`;
    const meta: SessionMeta = { id, repo, taskKey, title: "Session", createdAt: Date.now(), ...opts };
    await this.state.update((s) => void s.sessions.push(meta));
    const view: SessionView = { ...meta, agent: opts.agent ?? "claude", status: "running", exitCode: null, activity: "starting" };
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
  stopped: string[] = [];
  async stop(id: string) {
    this.stopped.push(id);
    this.exit(id);
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
    // The run keeps the prompt as it was pasted, for the task screen.
    expect((await state.load()).runs[0].sentPrompt).toMatchObject({ stepIndex: 0, text: fake.pasted[1] });
    expect(await hook("Stop")).toMatchObject({ phase: "waiting" });
    await write("02-plan.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate" });

    await engine.approve(repo, "DEMO-1");
    expect(fake.pasted[2]).toContain("đã được duyệt");
    expect((await engine.view(repo, "DEMO-1")).run?.sentPrompt).toMatchObject({ stepIndex: 1, text: fake.pasted[2] });
    await write("04-summary.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate", stepIndex: 1 });
    expect(await engine.approve(repo, "DEMO-1")).toMatchObject({ phase: "done" });
  });

  it("shows Claude's questions: from its last message while it waits, from the plan at the gate", async () => {
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    const id = (await state.load()).runs[0].sessionId;
    fake.sessions.get(id)!.activity = "idle";
    await engine.onHook(fake.meta(id), "Stop", { last_assistant_message: "Cần ba chốt:\n\n1. Dùng Redis? — Đề xuất: không\n" });
    expect(await engine.view(repo, "DEMO-1")).toMatchObject({ run: { phase: "waiting" }, questions: [{ n: 1, text: "Dùng Redis?", proposal: "không" }] });

    await hook("UserPromptSubmit");
    await mkdir(taskDir(), { recursive: true });
    await writeFile(path.join(taskDir(), "02-plan.md"), "# Plan\n\n## 6. Câu hỏi mở\n\n1. Tách task? — Đề xuất: không\n2. Đổi tên bước?\n");
    await engine.onHook(fake.meta(id), "Stop", { last_assistant_message: "Xong.\n\n1. Câu khác?" });
    const view = await engine.view(repo, "DEMO-1");
    expect(view.run?.phase).toBe("gate");
    expect(view.questions).toEqual([
      { n: 1, text: "Tách task?", proposal: "không" },
      { n: 2, text: "Đổi tên bước?" },
    ]);
  });

  it("answers Claude while it waits and approves a gate with answers, both logged", async () => {
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    await expect(engine.reply(repo, "DEMO-1", "Có")).rejects.toMatchObject({ status: 409 });
    expect(await hook("Stop")).toMatchObject({ phase: "waiting" });
    await expect(engine.reply(repo, "DEMO-1", "  ")).rejects.toMatchObject({ status: 400 });

    expect(await engine.reply(repo, "DEMO-1", "1. Dùng Redis?\n   → Theo đề xuất: không")).toMatchObject({ phase: "running" });
    expect(fake.pasted.at(-1)).toBe("1. Dùng Redis?\n   → Theo đề xuất: không");

    await write("02-plan.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate" });
    expect(await engine.approve(repo, "DEMO-1", "1. Tách task?\n   → Không")).toMatchObject({ phase: "running", stepIndex: 1 });

    const log = await readFile(path.join(taskDir(), HISTORY_FILE), "utf8");
    expect(log).toContain("· Điều tra & lên kế hoạch · Ba trả lời\n\n> 1. Dùng Redis?\n>    → Theo đề xuất: không\n");
    expect(log).toContain("· Điều tra & lên kế hoạch · Ba duyệt\n\n> 1. Tách task?\n>    → Không\n");
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

  it("runs a step for another agent in a new session and logs the switch", async () => {
    engine = new WorkflowEngine(state, fake, async (r) => {
      const def = await loadWorkflow(r);
      def.steps[1].agent = "copilot";
      return def;
    });
    // The run object is updated in place; keep the first session's id.
    const first = (await engine.start(repo, "DEMO-1")).sessionId;
    expect(fake.sessions.get(first)?.agent).toBe("claude");
    await hook("SessionStart");
    await write("02-plan.md");
    await hook("Stop");
    expect((await engine.view(repo, "DEMO-1")).workflow.steps.map((s) => s.agent)).toEqual(["claude", "copilot"]);

    const next = await engine.approve(repo, "DEMO-1");
    expect(fake.stopped).toEqual([first]);
    expect(next.sessionId).not.toBe(first);
    expect(fake.sessions.get(next.sessionId)).toMatchObject({ agent: "copilot" });
    // The new session gets the step once it reports SessionStart.
    expect(next).toMatchObject({ phase: "starting", stepIndex: 1 });
    expect(await hook("SessionStart")).toMatchObject({ phase: "running" });
    expect(fake.pasted.at(-1)).toContain("· Triển khai · Copilot");

    // The old session's exit no longer belongs to the run.
    await engine.onExit(fake.meta(first));
    expect((await state.load()).runs[0]).toMatchObject({ phase: "running", sessionId: next.sessionId });

    // The Copilot session stopping interrupts the run; retry resumes that session, not Claude's.
    fake.exit(next.sessionId);
    await engine.onExit(fake.meta(next.sessionId));
    expect((await state.load()).runs[0]).toMatchObject({ phase: "interrupted" });
    await engine.retry(repo, "DEMO-1");
    expect(fake.resumed).toEqual([next.sessionId]);
    await hook("SessionStart");
    await write("04-summary.md");
    expect(await hook("Stop")).toMatchObject({ phase: "gate", stepIndex: 1 });

    const log = await readFile(path.join(taskDir(), HISTORY_FILE), "utf8");
    expect(log).toContain("· Triển khai · Đổi agent\n\nBước này chạy bằng Copilot trong session mới; session Claude của bước trước đã dừng.");

    // A restart starts over with step 1's agent.
    const again = await engine.restart(repo, "DEMO-1");
    expect(fake.sessions.get(again.sessionId)).toMatchObject({ agent: "claude" });
    expect(again.stepIndex).toBe(0);
  });

  it("keeps one session when every step uses the same agent, also for snapshots saved without agents", async () => {
    engine = new WorkflowEngine(state, fake, async (r) => {
      const def = await loadWorkflow(r);
      // As saved by a TaskPilot without agents.
      for (const s of def.steps) delete (s as { agent?: Agent }).agent;
      delete (def as { agent?: Agent }).agent;
      return def;
    });
    const run = await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    await write("02-plan.md");
    await hook("Stop");
    expect(await engine.approve(repo, "DEMO-1")).toMatchObject({ sessionId: run.sessionId, phase: "running", stepIndex: 1 });
    expect(fake.stopped).toEqual([]);
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

  it("logs feedback verbatim, approvals and cancel to the task's history", async () => {
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    expect(fake.pasted[0]).toContain(`.claude/tasks/DEMO-1/${HISTORY_FILE}`);
    expect(fake.pasted[0]).toContain("· Điều tra & lên kế hoạch · Claude");
    await write("02-plan.md");
    await hook("Stop");
    await engine.feedback(repo, "DEMO-1", "Tách task riêng\n\nThêm 00-history.md");
    await write("02-plan.md");
    await hook("Stop");
    await engine.approve(repo, "DEMO-1");
    await engine.cancel(repo, "DEMO-1");

    const log = await readFile(path.join(taskDir(), HISTORY_FILE), "utf8");
    expect(log.startsWith("# DEMO-1 — Lịch sử quyết định\n\n## ")).toBe(true);
    expect(log).toContain("· Điều tra & lên kế hoạch · Bắt đầu quy trình\n\nQuy trình: mặc định của TaskPilot, 2 bước.");
    expect(log).toContain("· Điều tra & lên kế hoạch · Ba góp ý\n\n> Tách task riêng\n>\n> Thêm 00-history.md\n");
    expect(log).toContain("· Điều tra & lên kế hoạch · Ba duyệt");
    expect(log).toContain("· Triển khai · Huỷ quy trình");
    expect(log.indexOf("Ba góp ý")).toBeLessThan(log.indexOf("Ba duyệt"));
  });

  it("appends to a history the task already has and logs interruptions", async () => {
    await writeFile(path.join(taskDir(), HISTORY_FILE), "# Viết tay\n\n- quyết định cũ\n");
    const run = await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    fake.exit(run.sessionId);
    await engine.onExit(fake.meta(run.sessionId));

    const log = await readFile(path.join(taskDir(), HISTORY_FILE), "utf8");
    expect(log.startsWith("# Viết tay\n\n- quyết định cũ\n\n## ")).toBe(true);
    expect(log).toContain("· Gián đoạn\n\nSession dừng giữa bước.");
  });

  it("restarts from the first step in a new session and archives the documents first", async () => {
    await expect(engine.restart(repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    const first = await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    await write("02-plan.md");
    await hook("Stop");
    await engine.approve(repo, "DEMO-1");
    await write("03-progress.md");
    fake.exit(first.sessionId);
    await engine.onExit(fake.meta(first.sessionId));
    expect((await state.load()).runs[0]).toMatchObject({ phase: "interrupted", stepIndex: 1 });

    const run = await engine.restart(repo, "DEMO-1");
    expect(run).toMatchObject({ phase: "starting", stepIndex: 0 });
    expect(run.sessionId).not.toBe(first.sessionId);
    // The old session had already exited: nothing to stop.
    expect(fake.stopped).toEqual([]);
    expect((await state.load()).runs).toHaveLength(1);

    const archive = path.join(taskDir(), "archive");
    const [stamp] = await readdir(archive);
    expect(stamp).toMatch(/^\d{8}-\d{6}$/);
    expect((await readdir(path.join(archive, stamp))).sort()).toEqual(["02-plan.md", "03-progress.md"]);
    // Documents stay in place for Claude to read and rewrite.
    expect((await readdir(taskDir())).sort()).toEqual([HISTORY_FILE, "02-plan.md", "03-progress.md", "archive", "notes.txt", "spec"].sort());

    const log = await readFile(path.join(taskDir(), HISTORY_FILE), "utf8");
    expect(log).toContain(`· Triển khai · Chạy lại từ đầu\n\nBản cũ: archive/${stamp}/ (02-plan.md, 03-progress.md)`);
    expect(log.lastIndexOf("Bắt đầu quy trình")).toBeGreaterThan(log.indexOf("Chạy lại từ đầu"));

    // The new run's first prompt sends Claude to the archived plan and progress first.
    expect(run.previous).toEqual({ dir: `archive/${stamp}`, files: ["02-plan.md", "03-progress.md"] });
    await hook("SessionStart");
    const prompt = fake.pasted.at(-1)!;
    expect(prompt).toContain("Task này được chạy lại từ bước đầu.");
    expect(prompt).toContain(`- .claude/tasks/DEMO-1/archive/${stamp}/02-plan.md\n- .claude/tasks/DEMO-1/archive/${stamp}/03-progress.md\n`);
    expect(prompt).not.toMatch(/\n{3}/);
    expect(fake.pasted[0]).not.toContain("chạy lại từ bước đầu");
  });

  it("keeps a run on the workflow it started with; a restart picks up edits", async () => {
    const dir = path.join(repo, ".claude", "taskpilot");
    await mkdir(dir, { recursive: true });
    const yml = (prompt: string, steps: string) =>
      `version: 2\nhistory: {file: log.md}\nsteps:\n${steps}`.replace("PROMPT", prompt);
    await writeFile(path.join(dir, "one.md"), "First {{key}} {{outputs}} {{previousRun}}");
    await writeFile(path.join(dir, "two.md"), "Second {{out.plan}}");
    await writeFile(
      path.join(dir, "workflow.yml"),
      yml("", "  - {id: a, prompt: one.md, outputs: [{id: plan, file: ke-hoach.md}], done-when: plan}\n  - {id: b, prompt: two.md}\n"),
    );
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    expect(fake.pasted[0]).toContain("First DEMO-1 - `.claude/tasks/DEMO-1/ke-hoach.md`");

    // Edited mid-run: one step only, another prompt text.
    await writeFile(path.join(dir, "one.md"), "Edited {{previousRun}} {{outputs}}");
    await writeFile(path.join(dir, "workflow.yml"), yml("", "  - {id: a, prompt: one.md, outputs: [{id: plan, file: ke-hoach.md}]}\n"));
    expect((await engine.view(repo, "DEMO-1")).workflow).toMatchObject({ origin: "repo", outdated: true, historyFile: "log.md" });
    expect((await engine.view(repo, "DEMO-1")).workflow.steps).toHaveLength(2);
    expect((await engine.view(repo, "DEMO-1")).run).not.toHaveProperty("workflow");

    await write("ke-hoach.md");
    await hook("Stop");
    expect(fake.pasted[1]).toBe("Second .claude/tasks/DEMO-1/ke-hoach.md");
    expect(await hook("Stop")).toMatchObject({ phase: "done" });
    expect(await readFile(path.join(taskDir(), "log.md"), "utf8")).toContain("Quy trình: .claude/taskpilot/, 2 bước.");

    await engine.restart(repo, "DEMO-1");
    await hook("SessionStart");
    expect(fake.pasted.at(-1)).toMatch(/^Edited Task này được chạy lại/);
    expect((await engine.view(repo, "DEMO-1")).workflow).toMatchObject({ outdated: false });
  });

  it("follows the current workflow for runs saved before snapshots existed", async () => {
    await engine.start(repo, "DEMO-1");
    await state.update((s) => void delete s.runs[0].workflow);
    await hook("SessionStart");
    expect(fake.pasted[0]).toContain('task DEMO-1: "Health endpoint"');
  });

  it("stops the session of a run that is still working before restarting", async () => {
    const first = await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    expect((await state.load()).runs[0]).toMatchObject({ phase: "running" });
    await engine.restart(repo, "DEMO-1");
    expect(fake.stopped).toEqual([first.sessionId]);
    // The old session's exit no longer touches the new run.
    await engine.onExit(fake.meta(first.sessionId));
    expect((await state.load()).runs[0]).toMatchObject({ phase: "starting", stepIndex: 0 });
  });

  it("marks active runs interrupted after a restart", async () => {
    await engine.start(repo, "DEMO-1");
    await hook("SessionStart");
    await new WorkflowEngine(state, fake).recover();
    expect((await state.load()).runs[0]).toMatchObject({ phase: "interrupted" });
  });
});
