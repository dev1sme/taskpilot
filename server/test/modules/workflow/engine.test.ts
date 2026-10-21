import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionView } from "../../../src/modules/sessions/manager.js";
import type { SessionMeta } from "../../../src/core/state.js";
import { StateStore } from "../../../src/core/state.js";
import type { Agent } from "../../../src/core/agents.js";
import { LEADER_WORKFLOW_DIR, loadWorkflow, parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { WorkflowEngine, type SessionPort } from "../../../src/modules/workflow/engine.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const HISTORY_FILE = "00-history.md";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory SessionPort recording pasted prompts. */
class FakeSessions implements SessionPort {
  sessions = new Map<string, SessionView>();
  pasted: string[] = [];
  /** What was pasted into each session. */
  pastedBy = new Map<string, string[]>();
  resumed: string[] = [];
  constructor(private readonly state: StateStore) {}

  async create(repo: string, taskKey: string, opts: { permissionMode?: string; agent?: Agent; title?: string }): Promise<SessionView> {
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
    this.pastedBy.set(id, [...(this.pastedBy.get(id) ?? []), text]);
    this.sessions.get(id)!.activity = "busy";
  }
  /** Sessions that sent a hook; the fake's `hook()` helper does not mark them, tests do. */
  seen = new Set<string>();
  hookSeen(id: string) {
    return this.seen.has(id);
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

  describe("a Copilot step that sends no hook", () => {
    const WARN_MS = 40;
    async function startCopilotRun(agentOf: (i: number) => "claude" | "copilot") {
      engine = new WorkflowEngine(
        state,
        fake,
        async (r) => {
          const def = await loadWorkflow(r);
          def.steps.forEach((s, i) => (s.agent = agentOf(i)));
          return def;
        },
        WARN_MS,
      );
      const run = await engine.start(repo, "DEMO-1");
      await hook("SessionStart");
      return run.sessionId;
    }
    const message = async () => (await state.load()).runs[0].message;

    it("says so after the timeout, and drops the warning once a hook arrives", async () => {
      await startCopilotRun(() => "copilot");
      expect(await message()).toContain("đang làm bước");
      await sleep(WARN_MS + 60);
      expect(await state.load().then((s) => s.runs[0])).toMatchObject({ phase: "running", message: expect.stringContaining("không chạy hook") });
      expect(await hook("PostToolUse")).toMatchObject({ phase: "running", message: expect.stringContaining("đang làm bước") });
    });

    it("stays quiet when a hook came in time, and for Claude", async () => {
      const id = await startCopilotRun(() => "copilot");
      fake.seen.add(id);
      await sleep(WARN_MS + 60);
      expect(await message()).toContain("đang làm bước");
    });

    it("does not warn for Claude", async () => {
      await startCopilotRun(() => "claude");
      await sleep(WARN_MS + 60);
      expect(await message()).toContain("đang làm bước");
    });
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

describe("workflow engine: dispatch", () => {
  let repo: string;
  let fake: FakeSessions;
  let engine: WorkflowEngine;
  let state: StateStore;
  const taskDir = () => path.join(repo, ".claude", "tasks", "DEMO-1");
  const table = (...rows: string[]) => ["## 7. Phân công", "", "| # | Việc | Agent | File | Đầu ra | Phụ thuộc |", "|---|---|---|---|---|---|", ...rows].join("\n");
  const TWO = table("| 1 | Parser | claude | server/a.ts | parser | - |", "| 2 | UI | copilot | client/ | ui | 1 |");

  async function leaderDef(parallel = 1) {
    const { def } = parseWorkflowFiles(await readWorkflowDir(LEADER_WORKFLOW_DIR), { dir: LEADER_WORKFLOW_DIR, origin: "default" });
    def!.steps[1].dispatch!.parallel = parallel;
    return def!;
  }
  async function setup(parallel = 1) {
    repo = await makeRepo();
    state = new StateStore(await tempDir("taskpilot-state-"));
    fake = new FakeSessions(state);
    const def = await leaderDef(parallel);
    engine = new WorkflowEngine(state, fake, async () => def);
  }
  async function write(name: string, text = "# x\n") {
    await mkdir(taskDir(), { recursive: true });
    await writeFile(path.join(taskDir(), name), text);
  }
  const run = async () => (await state.load()).runs[0];
  /** Fires a hook in one session, the way the session's own agent would. */
  async function hookOn(id: string, event: Parameters<WorkflowEngine["onHook"]>[1], payload: Record<string, unknown> = {}) {
    fake.sessions.get(id)!.activity = event === "Stop" || event === "SessionStart" ? "idle" : "busy";
    await engine.onHook(fake.meta(id), event, payload);
    return run();
  }
  /** Leader plans with `plan`, the reviewer approves: the subtasks start. */
  async function dispatch(plan = TWO) {
    const leader = (await engine.start(repo, "DEMO-1")).sessionId;
    await hookOn(leader, "SessionStart");
    await write("02-plan.md", `# Plan\n\n${plan}\n`);
    await hookOn(leader, "Stop");
    await engine.approve(repo, "DEMO-1");
    return leader;
  }
  /** The subtask's agent starts, writes its report and ends the turn. */
  async function finish(n: number) {
    const sub = (await run()).subtasks!.find((s) => s.n === n)!;
    await hookOn(sub.sessionId!, "SessionStart");
    await write(sub.report);
    return hookOn(sub.sessionId!, "Stop");
  }

  beforeEach(() => setup());

  it("runs each subtask in its own session of its agent, in dependency order, then reviews in the leader's session", async () => {
    const leader = await dispatch();
    let r = await run();
    expect(r).toMatchObject({ stepIndex: 1, phase: "running", message: "Đang giao việc: 0/2 xong.", sessionId: leader });
    expect(r.subtasks!.map((s) => [s.n, s.phase, s.agent])).toEqual([[1, "starting", "claude"], [2, "pending", "copilot"]]);
    const first = r.subtasks![0].sessionId!;
    expect(fake.sessions.get(first)).toMatchObject({ agent: "claude", title: "Việc 1" });

    r = await hookOn(first, "SessionStart");
    expect(fake.pastedBy.get(first)![0]).toContain("Việc 1: Parser");
    expect(fake.pastedBy.get(first)![0]).toContain("File được sửa: `server/a.ts`");
    expect(fake.pastedBy.get(first)![0]).not.toContain("Không commit");

    // Without its report the subtask waits; the leader's session is not asked anything.
    expect(await hookOn(first, "Stop")).toMatchObject({ phase: "waiting", subtasks: [{ phase: "waiting" }, { phase: "pending" }] });
    await hookOn(first, "UserPromptSubmit");
    await write("03-viec-1.md");
    r = await hookOn(first, "Stop");
    expect(r.subtasks!.map((s) => s.phase)).toEqual(["done", "starting"]);
    expect(fake.stopped).toEqual([first]);
    expect(r).toMatchObject({ phase: "running", message: "Đang giao việc: 1/2 xong." });

    const second = r.subtasks![1].sessionId!;
    expect(fake.sessions.get(second)).toMatchObject({ agent: "copilot", title: "Việc 2" });
    await hookOn(second, "SessionStart");
    expect(fake.pastedBy.get(second)![0]).toContain("`.claude/tasks/DEMO-1/03-viec-1.md` (việc 1: Parser)");

    await write("03-viec-2.md");
    r = await hookOn(second, "Stop");
    expect(fake.stopped).toEqual([first, second]);
    expect(r).toMatchObject({ stepIndex: 2, phase: "running", sessionId: leader });
    expect(fake.pastedBy.get(leader)!.at(-1)).toContain("- Việc 2 · Copilot · UI → `.claude/tasks/DEMO-1/03-viec-2.md`");

    await write("04-summary.md");
    expect(await hookOn(leader, "Stop")).toMatchObject({ phase: "gate", stepIndex: 2 });
    expect(await engine.approve(repo, "DEMO-1")).toMatchObject({ phase: "done" });

    const log = await readFile(path.join(taskDir(), "00-history.md"), "utf8");
    for (const heading of ["· Giao việc\n\n1. Claude — Parser\n2. Copilot — UI (sau việc 1)", "· Việc 1 xong · Claude\n\nBáo cáo: 03-viec-1.md", "· Việc 2 xong · Copilot", "· Giao việc · Về leader rà soát\n\n2 việc đã xong"]) {
      expect(log).toContain(heading);
    }
  });

  it("ignores hooks of the leader's idle session while subtasks work", async () => {
    const leader = await dispatch();
    expect(await hookOn(leader, "Stop")).toMatchObject({ stepIndex: 1, phase: "running" });
    fake.exit(leader);
    await engine.onExit(fake.meta(leader));
    expect(await run()).toMatchObject({ phase: "running" });
    expect(await engine.usesSession(leader)).toBe(true);
    expect(await engine.usesSession((await run()).subtasks![0].sessionId!)).toBe(true);
  });

  it("resumes the leader's session for the review when it exited meanwhile", async () => {
    const leader = await dispatch();
    fake.exit(leader);
    await engine.onExit(fake.meta(leader));
    await finish(1);
    await finish(2);
    expect(fake.resumed).toEqual([leader]);
    expect(await run()).toMatchObject({ stepIndex: 2, phase: "starting", sessionId: leader });
    expect(await hookOn(leader, "SessionStart")).toMatchObject({ phase: "running" });
    expect(fake.pastedBy.get(leader)!.at(-1)).toContain("Rà soát");
  });

  it("refuses to approve a plan whose table cannot run, and says why in the view", async () => {
    const leader = (await engine.start(repo, "DEMO-1")).sessionId;
    await hookOn(leader, "SessionStart");
    await write("02-plan.md", "# Plan\n\n" + table("| 1 | A | gemini | - | x | 3 |"));
    await hookOn(leader, "Stop");
    const view = await engine.view(repo, "DEMO-1");
    expect(view.assignments!.items).toEqual([]);
    expect(view.assignments!.errors).toEqual(expect.arrayContaining([expect.stringContaining('unknown agent "gemini"')]));
    await expect(engine.approve(repo, "DEMO-1")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("gemini") });
    expect(await run()).toMatchObject({ phase: "gate", stepIndex: 0 });
    expect(fake.sessions.size).toBe(1);

    await write("02-plan.md", `# Plan\n\n${TWO}\n`);
    expect((await engine.view(repo, "DEMO-1")).assignments!.items.map((a) => a.n)).toEqual([1, 2]);
  });

  it("starts subtasks at once only when their files do not overlap; the rest queue", async () => {
    await setup(2);
    const rows = [
      "| 1 | A | claude | server/ | a | - |",
      "| 2 | B | copilot | client/ | b | - |",
      "| 3 | C | claude | server/x.ts | c | - |",
      "| 4 | D | claude | docs/ | d | 1 |",
    ];
    await dispatch(table(...rows));
    let r = await run();
    expect(r.subtasks!.map((s) => s.phase)).toEqual(["starting", "starting", "pending", "pending"]);
    await hookOn(r.subtasks![0].sessionId!, "SessionStart");
    expect(fake.pastedBy.get(r.subtasks![0].sessionId!)![0]).toContain("Không commit");

    await finish(2);
    r = await run();
    // 3 overlaps 1, which is still running; 4 waits for 1.
    expect(r.subtasks!.map((s) => s.phase)).toEqual(["running", "done", "pending", "pending"]);
    await finish(1);
    r = await run();
    expect(r.subtasks!.map((s) => s.phase)).toEqual(["done", "done", "starting", "starting"]);
  });

  it("needs files for every subtask when they may run in parallel", async () => {
    await setup(2);
    const leader = (await engine.start(repo, "DEMO-1")).sessionId;
    await hookOn(leader, "SessionStart");
    await write("02-plan.md", "# Plan\n\n" + table("| 1 | A | claude | - | a | - |"));
    await hookOn(leader, "Stop");
    await expect(engine.approve(repo, "DEMO-1")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("File is required") });
  });

  it("answers a waiting subtask and retries an interrupted one, each on its own", async () => {
    await setup(2);
    const leader = await dispatch(table("| 1 | A | claude | a/ | a | - |", "| 2 | B | copilot | b/ | b | - |"));
    const [one, two] = (await run()).subtasks!.map((s) => s.sessionId!);
    await hookOn(one, "SessionStart");
    await hookOn(two, "SessionStart");

    await hookOn(one, "Stop", { last_assistant_message: "Hỏi ba:\n\n1. Dùng Redis? — Đề xuất: không\n" });
    let r = await run();
    expect(r).toMatchObject({ phase: "waiting" });
    expect((await engine.view(repo, "DEMO-1")).subtaskQuestions).toEqual({ 1: [{ n: 1, text: "Dùng Redis?", proposal: "không" }] });
    // The run-level reply and retry belong to the leader, which has nothing to answer now.
    await expect(engine.reply(repo, "DEMO-1", "Không")).rejects.toMatchObject({ status: 409 });
    await expect(engine.retry(repo, "DEMO-1")).rejects.toMatchObject({ status: 409 });
    await expect(engine.replySubtask(repo, "DEMO-1", 2, "x")).rejects.toMatchObject({ status: 409 });
    await expect(engine.replySubtask(repo, "DEMO-1", 9, "x")).rejects.toMatchObject({ status: 404 });
    await expect(engine.replySubtask(repo, "DEMO-1", 1, " ")).rejects.toMatchObject({ status: 400 });

    r = await engine.replySubtask(repo, "DEMO-1", 1, "Không dùng");
    expect(fake.pastedBy.get(one)!.at(-1)).toBe("Không dùng");
    expect(r).toMatchObject({ phase: "running", subtasks: [{ phase: "running" }, { phase: "running" }] });

    fake.exit(two);
    await engine.onExit(fake.meta(two));
    r = await run();
    expect(r).toMatchObject({ phase: "interrupted", subtasks: [{ phase: "running" }, { phase: "interrupted" }] });
    expect(r.message).toContain("Việc 2");

    await engine.retrySubtask(repo, "DEMO-1", 2);
    expect(fake.resumed).toEqual([two]);
    r = await hookOn(two, "SessionStart");
    expect(r).toMatchObject({ phase: "running", subtasks: [{ phase: "running" }, { phase: "running" }] });
    expect(fake.pastedBy.get(two)).toHaveLength(2);
    expect(fake.sessions.get(leader)!.status).toBe("running");

    const log = await readFile(path.join(taskDir(), "00-history.md"), "utf8");
    expect(log).toContain("· Giao việc · Ba trả lời việc 1\n\n> Không dùng");
    expect(log).toContain("· Giao việc · Việc 2 gián đoạn");
  });

  it("stops every subtask session on restart, and marks them interrupted after a server restart", async () => {
    await setup(2);
    await dispatch(table("| 1 | A | claude | a/ | a | - |", "| 2 | B | copilot | b/ | b | - |"));
    const [one, two] = (await run()).subtasks!.map((s) => s.sessionId!);
    await hookOn(one, "SessionStart");
    await hookOn(two, "SessionStart");

    fake.exit(one);
    fake.exit(two);
    await new WorkflowEngine(state, fake).recover();
    expect((await run()).subtasks!.map((s) => s.phase)).toEqual(["interrupted", "interrupted"]);
    expect(await run()).toMatchObject({ phase: "interrupted" });

    await engine.retrySubtask(repo, "DEMO-1", 1);
    await hookOn(one, "SessionStart");
    await engine.restart(repo, "DEMO-1");
    expect(fake.stopped).toContain(one);
    expect(await run()).toMatchObject({ phase: "starting", stepIndex: 0 });
    expect((await run()).subtasks).toBeUndefined();
    // A stopped subtask session no longer belongs to the new run.
    await engine.onExit(fake.meta(one));
    expect(await run()).toMatchObject({ phase: "starting" });
  });

  it("keeps a static workflow free of subtasks", async () => {
    engine = new WorkflowEngine(state, fake);
    await engine.start(repo, "DEMO-1");
    expect(await engine.view(repo, "DEMO-1")).toMatchObject({ assignments: null, subtaskQuestions: {} });
    expect((await run()).subtasks).toBeUndefined();
  });
});
