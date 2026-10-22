import { rm } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { LaunchOptions, Launcher } from "../../../src/core/claude/launch.js";
import { StateStore } from "../../../src/core/state.js";
import { loadWorkflow, parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";

const LEADER_WORKFLOW_DIR = modeDir("leader");

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

/**
 * Stands in for claude with hooks: reports SessionStart, then a Stop after every input line.
 * Writes 02-plan.md when the prompt mentions it, like Claude doing the investigate step.
 */
const SCRIPT = `
post() { printf '{"session_id":"%s"}' "$1" | curl -sS -m 5 -o /dev/null -X POST \\
  -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" \\
  --data-binary @- "$TASKPILOT_HOOK_URL/$2"; }
post "$1" SessionStart
while IFS= read -r line; do
  case "$line" in *02-plan.md*) echo plan > .claude/tasks/DEMO-1/02-plan.md ;; esac
  post "$1" Stop
done`;
const hookedClaude: Launcher = (id) => ({ file: "/bin/sh", args: ["-c", SCRIPT, "sh", id] });

/** A leader and its members: the plan carries an assignment table, each subtask writes its own report. */
const TABLE = [
  "## 7. Phân công",
  "",
  "| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |",
  "|---|---|---|---|---|---|---|---|",
  "| 1 | Parser | claude | taskpilot-implementer | haiku | server/a.ts | parser | - |",
  "| 2 | UI | copilot | - | gpt-5 | client/ | ui | 1 |",
];
/** The options each fake agent was launched with, in order. */
const launched: Array<{ agent: string } & LaunchOptions> = [];
const LEADER_CLAUDE = `
post() { printf '{"session_id":"%s"}' "$1" | curl -sS -m 5 -o /dev/null -X POST \\
  -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" \\
  --data-binary @- "$TASKPILOT_HOOK_URL/$2"; }
post "$1" SessionStart
while IFS= read -r line; do
  case "$line" in
    *"Việc 1: "*) echo r > .claude/tasks/DEMO-1/03-viec-1.md ;;
    *04-summary.md*) echo summary > .claude/tasks/DEMO-1/04-summary.md ;;
    *02-plan.md*) printf '%s\\n' '# Plan' '' ${TABLE.map((l) => `'${l}'`).join(" ")} > .plan.tmp && mv .plan.tmp .claude/tasks/DEMO-1/02-plan.md ;;
  esac
  post "$1" Stop
done`;
const leaderClaude: Launcher = (id, opts) => (launched.push({ agent: "claude", ...opts }), { file: "/bin/sh", args: ["-c", LEADER_CLAUDE, "sh", id] });
const memberCopilot: Launcher = (id, opts) => (launched.push({ agent: "copilot", ...opts }), { file: "/bin/sh", args: ["-c", COPILOT_SCRIPT.replace("*04-summary.md*) echo summary > .claude/tasks/DEMO-1/04-summary.md", '*"Việc 2: "*) echo r > .claude/tasks/DEMO-1/03-viec-2.md'), "sh", id] });

/**
 * Stands in for copilot: prints its input box footer (the ready marker), and fires SessionStart
 * only with the first prompt. Writes 04-summary.md and a transcript when the prompt mentions it.
 */
const COPILOT_SCRIPT = `
post() { printf '%s' "$3" | curl -sS -m 5 -o /dev/null -X POST \\
  -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" \\
  --data-binary @- "$TASKPILOT_HOOK_URL/$2"; }
t="$PWD/.claude/tasks/DEMO-1/transcript.jsonl"
echo "/ commands"
while IFS= read -r line; do
  post "$1" UserPromptSubmit '{"session_id":"'"$1"'"}'
  post "$1" SessionStart '{"session_id":"'"$1"'","source":"new"}'
  case "$line" in *04-summary.md*) echo summary > .claude/tasks/DEMO-1/04-summary.md ;; esac
  printf '%s\\n' '{"type":"assistant.message","data":{"content":"Xong.\\n\\n1. Gộp PR? — Đề xuất: có"}}' > "$t"
  post "$1" Stop '{"session_id":"'"$1"'","transcript_path":"'"$t"'"}'
done`;
const hookedCopilot: Launcher = (id) => ({ file: "/bin/sh", args: ["-c", COPILOT_SCRIPT, "sh", id] });

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start(opts: { implementWith?: "copilot"; leader?: boolean } = {}) {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  const loadDef = async (repo: string) => {
    if (opts.leader) return parseWorkflowFiles(await readWorkflowDir(LEADER_WORKFLOW_DIR), { dir: LEADER_WORKFLOW_DIR, origin: "default" }).def!;
    const def = await loadWorkflow(repo);
    if (opts.implementWith) def.steps[1].agent = opts.implementWith;
    return def;
  };
  const repo = await makeRepo();
  // The fixture's plan would count as written before the leader has planned.
  if (opts.leader) await rm(path.join(repo, ".claude", "tasks", "DEMO-1", "02-plan.md"));
  app = await buildApp({ token: TOKEN, state, repo, launcher: opts.leader ? leaderClaude : hookedClaude, launchers: { copilot: opts.leader ? memberCopilot : hookedCopilot }, loadWorkflow: loadDef, copilotQuota: async () => ({ ok: false, reason: "missing" }) });
  // Hooks need a real port to call back to.
  await app.listen({ host: "127.0.0.1", port: 0 });
  return app;
}

async function waitFor<T>(read: () => Promise<T>, pred: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`timeout; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("workflow run end to end", () => {
  it("rejects a mode that is not a string", async () => {
    const app = await start();
    const res = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok, payload: { mode: 5 } });
    expect(res.statusCode).toBe(400);
  });

  it("starts a session, sends the prompt after SessionStart and stops at the plan gate", async () => {
    const app = await start();
    const started = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok });
    expect(started.statusCode).toBe(200);

    const view = await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "gate",
    );
    expect(view.workflow.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "implement"]);
    expect(view.run.message).toContain("02-plan.md");

    const tasks = (await app.inject({ url: "/api/tasks", headers: ok })).json();
    expect(tasks.find((t: { key: string }) => t.key === "DEMO-1")).toMatchObject({
      run: { phase: "gate", stepIndex: 0 },
      waitingPermission: false,
    });
  });

  it("hands the implement step to Copilot in a new session and stops at its gate", async () => {
    const app = await start({ implementWith: "copilot" });
    const run = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    const view = async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await waitFor(view, (v) => v.run?.phase === "gate");
    expect((await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/approve", headers: ok, payload: {} })).statusCode).toBe(200);

    const gate = await waitFor(view, (v) => v.run?.phase === "gate" && v.run.stepIndex === 1);
    expect(gate.run.sessionId).not.toBe(run.sessionId);
    expect(gate.workflow.steps.map((s: { agent: string }) => s.agent)).toEqual(["claude", "copilot"]);
    // Copilot's last message comes from its transcript.
    expect(gate.run.lastMessage).toBe("Xong.\n\n1. Gộp PR? — Đề xuất: có");
    const sessions = await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json(),
      (list: { agent: string; status: string }[]) => list.length === 2 && list[0].status === "exited",
    );
    expect(sessions.map((x: { agent: string; status: string }) => [x.agent, x.status])).toEqual([
      ["claude", "exited"],
      ["copilot", "running"],
    ]);
  });

  it("runs a leader's plan: one session per subtask, each of its agent, then the review", async () => {
    const app = await start({ leader: true });
    const view = async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    const post = (url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: ok, payload });
    launched.length = 0;
    const leader = (await post("/api/tasks/DEMO-1/run")).json();
    const gate = await waitFor(view, (v) => v.run?.phase === "gate");
    expect(gate.assignments.items.map((a: { n: number; agent: string }) => [a.n, a.agent])).toEqual([[1, "claude"], [2, "copilot"]]);
    expect((await post("/api/tasks/DEMO-1/run/approve")).statusCode).toBe(200);

    const review = await waitFor(view, (v) => v.run?.stepIndex === 2 && v.run.phase === "gate");
    expect(review.run.sessionId).toBe(leader.sessionId);
    expect(review.run.subtasks.map((s: { phase: string }) => s.phase)).toEqual(["done", "done"]);
    const sessions = (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(sessions.map((x: { agent: string; title: string }) => [x.agent, x.title]).slice(1)).toEqual([["claude", "Việc 1"], ["copilot", "Việc 2"]]);
    // Each member runs with the subagent and model of its row; the leader with neither.
    expect(launched.map((o) => [o.agent, o.subagent, o.model])).toEqual([
      ["claude", undefined, undefined],
      ["claude", "taskpilot-implementer", "haiku"],
      ["copilot", undefined, "gpt-5"],
    ]);
    expect((await post("/api/tasks/DEMO-1/run/subtasks/1/retry")).statusCode).toBe(409);
    expect((await post("/api/tasks/DEMO-1/run/subtasks/1/reply", {})).statusCode).toBe(400);
    expect((await post("/api/tasks/DEMO-1/run/approve")).statusCode).toBe(200);
  });

  it("keeps a session that an active run depends on", async () => {
    const app = await start();
    const run = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await app.inject({ method: "POST", url: `/api/sessions/${run.sessionId}/stop`, headers: ok });
    await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "interrupted",
    );
    const del = await app.inject({ method: "DELETE", url: `/api/sessions/${run.sessionId}`, headers: ok });
    expect(del.statusCode).toBe(409);
    await app.inject({ method: "DELETE", url: "/api/tasks/DEMO-1/run", headers: ok });
    const after = await app.inject({ method: "DELETE", url: `/api/sessions/${run.sessionId}`, headers: ok });
    expect(after.statusCode).toBe(200);
  });

  it("restarts a run from the first step in a new session", async () => {
    const app = await start();
    const none = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/restart", headers: ok });
    expect(none.statusCode).toBe(409);

    const first = (await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json(),
      (v) => v.run?.phase === "gate",
    );
    const restarted = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/restart", headers: ok });
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toMatchObject({ stepIndex: 0 });
    expect(restarted.json().sessionId).not.toBe(first.sessionId);
    // The old session is stopped but stays listed.
    const sessions = await waitFor(
      async () => (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json(),
      (list: { id: string; status: string }[]) => list.find((x) => x.id === first.sessionId)?.status === "exited",
    );
    expect(sessions).toHaveLength(2);
  });

  it("checks the bodies of approve and reply, and answers only a waiting run", async () => {
    const app = await start();
    const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: ok, payload: payload as object });
    expect((await post("/api/tasks/DEMO-1/run/approve", { note: 5 })).statusCode).toBe(400);
    expect((await post("/api/tasks/DEMO-1/run/reply", {})).statusCode).toBe(400);
    expect((await post("/api/tasks/DEMO-1/run/reply", { text: "Có" })).statusCode).toBe(404);
  });

  it("rejects hook calls without a valid session token", async () => {
    const app = await start();
    const bad = await app.inject({
      method: "POST",
      url: "/hook/Stop",
      headers: { host: ok.host, "x-taskpilot-hook-token": "nope" },
      payload: {},
    });
    expect(bad.statusCode).toBe(403);
    const unknown = await app.inject({ method: "POST", url: "/hook/Nope", headers: { host: ok.host }, payload: {} });
    expect(unknown.statusCode).toBe(404);
  });
});
