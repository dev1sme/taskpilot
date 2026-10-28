import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ProviderId } from "../../../src/core/providers.js";
import type { SessionMeta } from "../../../src/core/state.js";
import { StateStore } from "../../../src/core/state.js";
import { preflightSession, type PreflightResult } from "../../../src/modules/sessions/capabilities.js";
import type { SessionView } from "../../../src/modules/sessions/manager.js";
import { loadWorkflow } from "../../../src/modules/workflow/definition.js";
import { WorkflowEngine, type SessionPort } from "../../../src/modules/workflow/engine.js";
import type { RunOptions, WorkflowDef } from "../../../src/modules/workflow/types.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";
import { fireHook } from "../../helpers/session-events.js";
import type { HookEvent } from "../../../src/modules/sessions/index.js";

afterAll(cleanupTempDirs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What the continuity text says (see PROMPT_TEXT.continued / PROMPT_TEXT.fresh). */
const CONTINUED = "Session này đã làm phần trước của task";
const FRESH = "Đọc trước tiên";

/** In-memory SessionPort that counts the sessions the engine opens. */
class FakeSessions implements SessionPort {
  sessions = new Map<string, SessionView>();
  pastedBy = new Map<string, string[]>();
  constructor(private readonly state: StateStore) {}
  preflight(repo: string, request: Parameters<typeof preflightSession>[0]) {
    // The Codex probe needs a real codex binary; this test is about sessions, not about the probe.
    if (request.agent === "codex") return Promise.resolve({ status: "ready", configuration: request, capability: {}, model: {}, errors: [] } as unknown as PreflightResult);
    return preflightSession(request, async () => ({ repo, command: { file: "/bin/bash", args: [] }, extraEnv: {}, timeoutMs: 1000 }));
  }
  async create(
    repo: string,
    taskKey: string,
    opts: { permissionMode?: string; agent?: ProviderId; title?: string; model?: string; subagent?: string; codex?: SessionMeta["codex"] },
  ): Promise<SessionView> {
    const id = `00000000-0000-4000-8000-${String(this.sessions.size).padStart(12, "0")}`;
    const meta: SessionMeta = { id, repo, taskKey, title: "Session", createdAt: Date.now(), ...opts };
    await this.state.update((s) => void s.sessions.push(meta));
    const view: SessionView = { ...meta, agent: opts.agent ?? "claude", status: "running", exitCode: null, activity: "starting" };
    this.sessions.set(id, view);
    return view;
  }
  async resume(id: string) {
    return Object.assign(this.sessions.get(id)!, { status: "running" as const, activity: "starting" as const });
  }
  async get(id: string) {
    return this.sessions.get(id)!;
  }
  async stop(id: string) {
    Object.assign(this.sessions.get(id)!, { status: "exited", activity: null });
  }
  paste(id: string, text: string) {
    this.pastedBy.set(id, [...(this.pastedBy.get(id) ?? []), text]);
    this.sessions.get(id)!.activity = "busy";
  }
  hookSeen() {
    return true;
  }
  meta(id: string): SessionMeta {
    return this.sessions.get(id)!;
  }
}

describe("economy: sessions a built-in default run opens", () => {
  let repo: string;
  let fake: FakeSessions;
  let state: StateStore;
  let engine: WorkflowEngine;
  const taskDir = () => path.join(repo, ".claude", "tasks", "DEMO-1");

  /** An engine whose workflow is the built-in `default` mode, optionally patched like a repo override would. */
  function useWorkflow(patch?: (def: WorkflowDef) => void) {
    engine = new WorkflowEngine(state, fake, async (r) => {
      const def = await loadWorkflow(r);
      patch?.(def);
      return def;
    });
  }

  async function write(name: string) {
    await mkdir(taskDir(), { recursive: true });
    await writeFile(path.join(taskDir(), name), "# x\n");
  }

  async function hook(event: HookEvent) {
    const run = (await state.load()).runs[0];
    fake.sessions.get(run.sessionId)!.activity = event === "Stop" || event === "SessionStart" ? "idle" : "busy";
    await fireHook(engine, fake.meta(run.sessionId), event);
    return (await state.load()).runs[0];
  }

  /** investigate → two rounds of feedback → approve → implement → two rounds of feedback → approve. */
  async function runThrough(opts?: RunOptions) {
    await engine.start(repo, "DEMO-1", opts);
    await hook("SessionStart");
    for (const [step, file] of [
      ["plan", "02-plan.md"],
      ["summary", "04-summary.md"],
    ] as const) {
      await write(file);
      expect(await hook("Stop")).toMatchObject({ phase: "gate" });
      for (const round of [1, 2]) {
        // Outside the engine's mtime slack, so the document above does not count for the next prompt.
        await sleep(150);
        await engine.feedback(repo, "DEMO-1", `${step} feedback ${round}`);
        await hook("SessionStart");
        await write(file);
        expect(await hook("Stop")).toMatchObject({ phase: "gate" });
      }
      await sleep(150);
      await engine.approve(repo, "DEMO-1");
      if (step === "plan") await hook("SessionStart");
    }
    return (await state.load()).runs[0];
  }

  /** Every prompt the run pasted, with the session it went to. */
  const prompts = () => [...fake.pastedBy.entries()].flatMap(([id, texts]) => texts.map((text) => ({ id, text })));

  beforeEach(async () => {
    repo = await makeRepo();
    state = new StateStore(await tempDir("taskpilot-state-"));
    fake = new FakeSessions(state);
    // The fixture's 02-plan.md predates every run.
    const past = new Date("2020-01-01");
    await utimes(path.join(taskDir(), "02-plan.md"), past, past);
  });

  it("follows the workflow in ONE session through both gates and every round of feedback", async () => {
    useWorkflow();
    const run = await runThrough();
    expect(run.phase).toBe("done");
    expect(fake.sessions.size).toBe(1);
    expect((await state.load()).sessions).toHaveLength(1);
  });

  it("opens a second session when an override gives the implement step to Copilot", async () => {
    useWorkflow((def) => {
      def.steps[1].agent = "copilot";
    });
    await runThrough();
    expect(fake.sessions.size).toBe(2);
    expect([...fake.sessions.values()].map((s) => s.agent)).toEqual(["claude", "copilot"]);
  });

  it("opens a second session when the implement step has other Codex options than the plan step", async () => {
    useWorkflow((def) => {
      def.steps[1].codex = { networkAccess: true };
    });
    await runThrough({ execution: { agent: "codex" } });
    expect(fake.sessions.size).toBe(2);
    expect([...fake.sessions.values()].map((s) => s.agent)).toEqual(["codex", "codex"]);
  });

  it("tells the reused session to read only the new history; a fresh session reads everything", async () => {
    useWorkflow();
    await runThrough();
    const sent = prompts().map((p) => p.text);
    // investigate (fresh session) + 2 feedback + implement + 2 feedback.
    expect(sent).toHaveLength(6);
    // The very first prompt opens the session: nothing to continue.
    expect(sent[0]).not.toContain(CONTINUED);
    // Feedback in the same session and the implement prompt that follows it continue.
    for (const text of sent.slice(1)) expect(text).toContain(CONTINUED);
    // They keep the fallback for a session that lost its context.
    for (const text of sent.slice(1)) expect(text).toContain("Nếu không còn bối cảnh");
    // No prompt asks for the documents the mode no longer writes.
    for (const text of sent) expect(text).not.toMatch(/01-investigation|03-progress/);
  });

  it("gives the session that replaces the old one a prompt that reads everything", async () => {
    useWorkflow((def) => {
      def.steps[1].agent = "copilot";
    });
    await runThrough();
    const [claude, copilot] = [...fake.pastedBy.values()];
    expect(claude).toHaveLength(3);
    expect(copilot).toHaveLength(3);
    // The first prompt of the new session cannot assume any earlier context.
    expect(copilot[0]).toContain(FRESH);
    expect(copilot[0]).not.toContain(CONTINUED);
    // Its own feedback rounds continue inside it.
    for (const text of copilot.slice(1)) expect(text).toContain(CONTINUED);
  });
});

describe("economy: documents of the built-in modes", () => {
  it("keeps only the plan and the summary (plus the member reports of leader)", async () => {
    const repo = await makeRepo();
    const files = async (mode: string) => (await loadWorkflow(repo, mode)).steps.flatMap((s) => [...s.outputs.map((o) => o.file), ...(s.dispatch ? [s.dispatch.report] : [])]);
    expect(await files("default")).toEqual(["02-plan.md", "04-summary.md"]);
    expect(await files("leader")).toEqual(["02-plan.md", "03-viec-{{n}}.md", "04-summary.md"]);
  });

  it("caps the leader's table at 4 members and never uses the removed documents in a prompt", async () => {
    const repo = await makeRepo();
    const leader = await loadWorkflow(repo, "leader");
    expect(leader.steps.find((s) => s.dispatch)?.dispatch?.maxSubtasks).toBe(4);
    for (const mode of ["default", "leader"]) {
      const def = await loadWorkflow(repo, mode);
      for (const step of def.steps) for (const text of [step.prompt, step.onReject, step.dispatch?.prompt]) expect(text ?? "").not.toMatch(/\{\{out\.(investigation|progress)\}\}/);
    }
  });
});
