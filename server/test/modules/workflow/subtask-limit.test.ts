import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { Launcher } from "../../../src/core/launch.js";
import { StateStore } from "../../../src/core/state.js";
import { parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";
import { SUBAGENTS_DIR } from "../../../src/modules/config/library/templates.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const LEADER_WORKFLOW_DIR = modeDir("leader");
const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };

const TABLE = [
  "## 7. Phân công",
  "",
  "| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |",
  "|---|---|---|---|---|---|---|---|",
  "| 1 | Parser | claude | - | - | server/a.ts | parser | - |",
  "| 2 | UI | claude | - | - | client/ | ui | 1 |",
  "| 3 | Docs | claude | - | - | docs/ | docs | 2 |",
];
/** Stands in for claude: writes the plan with the table, a report per subtask, the summary. */
const CLAUDE = `
post() { printf '{"session_id":"%s"}' "$1" | curl -sS -m 5 -o /dev/null -X POST \\
  -H "x-taskpilot-hook-token: $TASKPILOT_HOOK_TOKEN" -H "content-type: application/json" \\
  --data-binary @- "$TASKPILOT_HOOK_URL/$2"; }
post "$1" SessionStart
while IFS= read -r line; do
  case "$line" in
    *"Việc "[0-9]": "*) n="\${line#*Việc }"; echo r > ".claude/tasks/DEMO-1/03-viec-\${n%%:*}.md" ;;
    *04-summary.md*) echo summary > .claude/tasks/DEMO-1/04-summary.md ;;
    *02-plan.md*) printf '%s\\n' '# Plan' '' ${TABLE.map((l) => `'${l}'`).join(" ")} > .plan.tmp && mv .plan.tmp .claude/tasks/DEMO-1/02-plan.md ;;
  esac
  post "$1" Stop
done`;
const claude: Launcher = (id) => ({ file: "/bin/bash", args: ["-c", CLAUDE, "sh", id] });

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

async function start(maxSubtasks: number | undefined) {
  const state = new StateStore(await tempDir("taskpilot-state-"));
  const repo = await makeRepo();
  await rm(path.join(repo, ".claude", "tasks", "DEMO-1", "02-plan.md"));
  await cp(path.join(SUBAGENTS_DIR, "taskpilot-implementer.md"), path.join(repo, ".claude", "agents", "taskpilot-implementer.md"));
  const loadDef = async () => {
    const def = parseWorkflowFiles(await readWorkflowDir(LEADER_WORKFLOW_DIR), { dir: LEADER_WORKFLOW_DIR, origin: "default" }).def!;
    const dispatch = def.steps.find((s) => s.dispatch)!.dispatch!;
    dispatch.parallel = 1;
    if (maxSubtasks === undefined) delete dispatch.maxSubtasks;
    else dispatch.maxSubtasks = maxSubtasks;
    return def;
  };
  app = await buildApp({ token: TOKEN, state, repo, launcher: claude, loadWorkflow: loadDef, copilotQuota: async () => ({ ok: false, reason: "missing" }) });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, repo };
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

describe("dispatch.max-subtasks", () => {
  it("blocks a table over the limit even with parallel: 1, and changes nothing", async () => {
    const { app, repo } = await start(2);
    const view = async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json();
    await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok });
    const gate = await waitFor(view, (v) => v.run?.phase === "gate");
    expect(gate.workflow.steps.find((s: { dispatch: unknown }) => s.dispatch).dispatch.maxSubtasks).toBe(2);
    expect(gate.assignments.items).toEqual([]);
    expect(gate.assignments.errors.join(" ")).toMatch(/3 subtasks.*max-subtasks allows 2/);

    const planFile = path.join(repo, ".claude", "tasks", "DEMO-1", "02-plan.md");
    const before = await readFile(planFile, "utf8");
    const approve = await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/approve", headers: ok, payload: {} });
    expect(approve.statusCode).toBe(400);
    const after = await view();
    expect(after.run.phase).toBe("gate");
    expect(after.run.stepIndex).toBe(gate.run.stepIndex);
    expect(after.run.subtasks ?? []).toEqual([]);
    expect(await readFile(planFile, "utf8")).toBe(before);
    const sessions = (await app.inject({ url: "/api/tasks/DEMO-1/sessions", headers: ok })).json();
    expect(sessions).toHaveLength(1);
  });

  it("dispatches every row when the limit allows the table or the snapshot has no limit", async () => {
    for (const max of [3, undefined]) {
      const { app: running } = await start(max);
      const app = running;
      const view = async () => (await app.inject({ url: "/api/tasks/DEMO-1/run", headers: ok })).json();
      await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run", headers: ok });
      const gate = await waitFor(view, (v) => v.run?.phase === "gate");
      expect(gate.assignments.errors).toEqual([]);
      expect(gate.assignments.items).toHaveLength(3);
      expect((await app.inject({ method: "POST", url: "/api/tasks/DEMO-1/run/approve", headers: ok, payload: {} })).statusCode).toBe(200);
      const review = await waitFor(view, (v) => v.run?.stepIndex === 2 && v.run.phase === "gate");
      expect(review.run.subtasks).toHaveLength(3);
      await app.close();
    }
  });
});
