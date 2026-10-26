import path from "node:path";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import type { HookEvent } from "../../../src/modules/sessions/index.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { WorkflowEngine } from "../../../src/modules/workflow/engine.js";
import { parseWorkflowFiles } from "../../../src/modules/workflow/definition.js";
import { resolveExecution } from "../../../src/modules/workflow/execution.js";
import { subagentProblems } from "../../../src/modules/workflow/run-checks.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

/**
 * Stands in for the Codex TUI in a PTY: prints the footer (ready marker), then answers every pasted prompt
 * with hooks that carry its own thread id, the model and a rollout path, like the real hooks (fixtures/codex-tui).
 * `WRITE:<file>` writes a report (`PLAN_TABLE`: a plan with one Codex member); `INTERRUPT` fires Interrupt as Esc does.
 * The rollout's `token_count` grows by 100 input / 20 output tokens per turn.
 */
const CODEX_TUI = String.raw`
post() { printf '%s' "$2" | curl -sS -m 5 -o /dev/null -X POST -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" --data-binary @- "$TASKPILOT_HOOK_URL/$1"; }
thread=$(cat /proc/sys/kernel/random/uuid)
rollout="$PWD/.rollout-$thread.jsonl"
base='"session_id":"'$thread'","model":"gpt-6.1-sol","transcript_path":"'$rollout'"'
in=0; out=0; buf=""
echo "gpt-6.1-sol default · ~/repo"
while IFS= read -r line; do
  buf="$buf$line"$'\n'
  case "$line" in *$'\e[201~'*) ;; *) continue ;; esac
  post UserPromptSubmit "{$base}"
  case "$buf" in
    *INTERRUPT*) post Stop "{$base,\"hook_event_name\":\"Interrupt\"}"; buf=""; continue ;;
  esac
  file=$(printf '%s' "$buf" | sed -n 's/.*WRITE:\([A-Za-z0-9_.\/-]*\).*/\1/p' | head -1)
  if [ -n "$file" ]; then
    mkdir -p "$(dirname "$file")"
    case "$buf" in
      *PLAN_TABLE*) printf '%s\n' '# Plan' '' '## 7. Phân công' '' '| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |' '|---|---|---|---|---|---|---|---|' '| 1 | Report | codex | - | - | server/ | Report | - |' > "$file" ;;
      *) echo '# Report' > "$file" ;;
    esac
  fi
  in=$((in+100)); out=$((out+20))
  printf '%s\n' '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":'$in',"output_tokens":'$out'}}}}' >> "$rollout"
  post Stop "{$base,\"last_assistant_message\":\"DONE\"}"
  buf=""
done`;
// The pre-flight probe still asks `codex app-server` (models, login); only that call goes to the app-server stand-in.
const FAKE_APP_SERVER = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const codexTui = (id: string) => (id === "preflight" ? { file: process.execPath, args: [FAKE_APP_SERVER, "app-server"] } : { file: "/bin/bash", args: ["-c", CODEX_TUI] });
const managers: SessionManager[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.closeAll();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** A SessionManager with the stand-in TUI whose hooks reach it over a real local port, as TaskPilot's /hook routes do. */
async function codexSessions(state: StateStore): Promise<SessionManager> {
  let sessions!: SessionManager;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const event = (req.url ?? "").split("/").pop() as HookEvent;
      const token = req.headers["x-taskpilot-hook-token"];
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      void sessions.handleHook(typeof token === "string" ? token : "", event, payload).finally(() => res.end());
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as { port: number };
  sessions = new SessionManager(state, { launchers: { codex: codexTui }, hookUrl: () => `http://127.0.0.1:${port}/hook` });
  managers.push(sessions);
  return sessions;
}
afterAll(cleanupTempDirs);

it("runs a Codex leader, dispatches a Codex member, records tokens and completes feedback/gates", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-workflow-"));
  const sessions = await codexSessions(state);
  const files = new Map(
    Object.entries({
      "workflow.yml": `version: 2
agent: codex
permission-mode: acceptEdits
steps:
  - id: plan
    prompt: plan.md
    outputs: [{id: plan, file: 02-plan.md}]
    done-when: plan
    gate: approve
    on-reject: feedback.md
  - id: dispatch
    dispatch:
      from: plan
      prompt: member.md
      report: 03-viec-{{n}}.md
      parallel: 1
  - id: review
    prompt: review.md
    outputs: [{id: summary, file: 04-summary.md}]
    done-when: summary
    gate: approve
`,
      "plan.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md PLAN_TABLE {{outputs}}",
      "feedback.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md PLAN_TABLE {{feedback}}",
      "member.md": "WRITE:.claude/tasks/DEMO-1/03-viec-1.md {{subtask}}",
      "review.md": "WRITE:.claude/tasks/DEMO-1/04-summary.md {{outputs}}",
    }),
  );
  const { def, errors } = parseWorkflowFiles(files, { dir: repo, origin: "repo" });
  expect(errors).toEqual([]);
  const engine = new WorkflowEngine(state, sessions, async () => def!);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((e) => failures.push(e)));
  sessions.on("metrics", (meta, data) => void engine.onMetrics(meta, data).catch((e) => failures.push(e)));
  sessions.on("exit", (meta) => void engine.onExit(meta).catch((e) => failures.push(e)));
  const run = () => state.load().then((s) => s.runs[0]);
  await engine.start(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await run()).phase).toBe("gate"));
  await engine.feedback(repo, "DEMO-1", "Review again");
  await vi.waitFor(async () => expect((await run()).phase).toBe("gate"));
  await engine.approve(repo, "DEMO-1");
  await vi.waitFor(async () => expect(await run()).toMatchObject({ stepIndex: 2, phase: "gate" }));
  const sub = (await run()).subtasks?.[0];
  expect(sub).toMatchObject({ agent: "codex", phase: "done", metrics: { model: "gpt-6.1-sol", inputTokens: 100, outputTokens: 20 } });
  expect(await readFile(path.join(repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8")).toContain("100 token vào");
  await engine.approve(repo, "DEMO-1");
  expect((await run()).phase).toBe("done");
  expect(failures).toEqual([]);
});

it("rejects Codex plan mode in definitions and accepts Codex subagents in assignment checks", async () => {
  const parsed = parseWorkflowFiles(
    new Map([
      ["workflow.yml", "version: 2\nagent: codex\npermission-mode: plan\nsteps:\n  - id: a\n    prompt: p.md\n"],
      ["p.md", "Do work"],
    ]),
    { dir: "/wf", origin: "repo" },
  );
  expect(parsed.def).toBeNull();
  expect(parsed.errors.join(" ")).toContain("Plan mode");
  expect(await subagentProblems("/repo", [{ n: 1, title: "Task", agent: "codex", subagent: "reviewer", files: ["server/"], output: "report", deps: [] }])).toEqual([]);
});

it("keeps an interrupted (Esc) turn waiting even without done-when", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-failed-run-"));
  const sessions = await codexSessions(state);
  const def = parseWorkflowFiles(
    new Map([
      ["workflow.yml", "version: 2\nagent: codex\nsteps:\n  - id: run\n    prompt: p.md\n"],
      ["p.md", "INTERRUPT"],
    ]),
    { dir: repo, origin: "repo" },
  ).def!;
  const engine = new WorkflowEngine(state, sessions, async () => def);
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload));
  await engine.start(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("waiting"));
  // An interrupted turn has no answer to measure.
  expect((await state.load()).runs[0].sessionMetrics ?? []).toEqual([]);
});

it("records the thread id, model and rollout token totals of a Codex PTY lane", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-attempt-"));
  const sessions = await codexSessions(state);
  const def = parseWorkflowFiles(
    new Map([
      ["workflow.yml", "version: 2\nagent: codex\nsteps:\n  - id: run\n    prompt: p.md\n    gate: approve\n"],
      ["p.md", "WRITE:out.md"],
    ]),
    { dir: repo, origin: "repo" },
  ).def!;
  const engine = new WorkflowEngine(state, sessions, async () => def);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((e) => failures.push(e)));
  await engine.start(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("gate"));
  const saved = await state.load();
  const run = saved.runs[0];
  const meta = saved.sessions.find((s) => s.id === run.sessionId)!;
  expect(meta.nativeId).toMatch(/^[0-9a-f-]{36}$/);
  expect(run.attempts).toHaveLength(1);
  expect(run.attempts![0]).toMatchObject({
    sessionId: run.sessionId,
    nativeId: meta.nativeId,
    actualModel: "gpt-6.1-sol",
    metricsSource: "codex-thread",
    metrics: { model: "gpt-6.1-sol", inputTokens: 100, outputTokens: 20 },
  });
  expect(run.sessionMetrics).toMatchObject([{ sessionId: run.sessionId, nativeId: meta.nativeId, source: "codex-thread", basis: "thread", metrics: { inputTokens: 100, outputTokens: 20 } }]);
  expect(failures).toEqual([]);
});

it("preserves legacy Codex model switches when the run has no execution or attempt fields", async () => {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("codex-legacy-switch-"));
  const sessions = await codexSessions(state);
  const def = parseWorkflowFiles(
    new Map([
      [
        "workflow.yml",
        "version: 2\nagent: codex\nsteps:\n  - id: plan\n    model: gpt-6.1-sol\n    prompt: plan.md\n    gate: approve\n  - id: review\n    prompt: review.md\n    gate: approve\n",
      ],
      ["plan.md", "Plan {{agent}}"],
      ["review.md", "Review {{agent}}"],
    ]),
    { dir: repo, origin: "repo" },
  ).def!;
  const engine = new WorkflowEngine(state, sessions, async () => def);
  const failures: unknown[] = [];
  sessions.on("hook", (meta, event, payload) => void engine.onHook(meta, event, payload).catch((error) => failures.push(error)));
  const first = (await engine.start(repo, "DEMO-1")).sessionId;
  await vi.waitFor(async () => expect((await state.load()).runs[0].phase).toBe("gate"));
  await state.update((s) => {
    delete s.runs[0].execution;
    delete s.runs[0].executionSnapshot;
    delete s.runs[0].attempts;
  });
  await engine.approve(repo, "DEMO-1");
  await vi.waitFor(async () => expect((await state.load()).runs[0]).toMatchObject({ phase: "gate", stepIndex: 1 }));
  expect((await state.load()).runs[0].sessionId).not.toBe(first);
  expect((await state.load()).sessions).toHaveLength(2);
  expect(failures).toEqual([]);
});

it("passes `codex:` options to a Codex lane only", () => {
  const yml = (agent: string) => `version: 2\nagent: ${agent}\npermission-mode: acceptEdits\ncodex: {approvals-reviewer: auto_review, network: true}\nsteps:\n  - {id: a, prompt: p.md}\n`;
  const lane = (agent: string) => {
    const def = parseWorkflowFiles(
      new Map([
        ["workflow.yml", yml(agent)],
        ["p.md", "Plan"],
      ]),
      { dir: "/x", origin: "repo" },
    ).def!;
    return resolveExecution({ workflow: def, scope: { kind: "step", stepId: "a" } });
  };
  expect(lane("codex").codex).toEqual({ approvalsReviewer: "auto_review", networkAccess: true });
  expect(lane("claude").codex).toBeUndefined();
});
