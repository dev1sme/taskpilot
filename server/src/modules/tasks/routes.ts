import type { FastifyInstance } from "fastify";
import type { StateStore } from "../../core/state.js";
import type { RepoContext } from "../repo/index.js";
import type { SessionManager } from "../sessions/index.js";
import { getTask, listTasks, readTaskFile, type TaskSummary } from "./scan.js";
import { doneOf } from "./status.js";

/** How far a task got, as the repo's workflow reads its documents. */
export interface TaskStage {
  done: number;
  total: number;
  step: string | null;
}

/** What the repo's workflow says about task documents; supplied by the app so tasks does not depend on workflow. */
export type DescribeTasks = (repo: string) => Promise<{ stageOf: (files: string[], taskKey: string) => TaskStage; historyFile: string }>;

const UNKNOWN = { stageOf: () => ({ done: 0, total: 0, step: null }), historyFile: "" };

/** Tasks of the current repo, with their run phase and sessions, and the files inside a task. */
export function registerTasksRoutes(app: FastifyInstance, opts: { repo: RepoContext; state: StateStore; sessions: SessionManager; describe?: DescribeTasks }) {
  const { sessions } = opts;
  const requireRepo = opts.repo.require;
  // A broken workflow file must not hide the task list.
  const describe = (repo: string) => opts.describe?.(repo).catch(() => UNKNOWN) ?? Promise.resolve(UNKNOWN);
  const withStage = (task: TaskSummary, d: Awaited<ReturnType<typeof describe>>) => ({
    ...task,
    stage: d.stageOf(
      task.outputFiles.map((f) => f.path),
      task.key,
    ),
    historyFile: d.historyFile,
  });

  app.get("/api/tasks", async () => {
    const current = requireRepo();
    const { runs } = await opts.state.load();
    const d = await describe(current);
    return Promise.all(
      (await listTasks(current)).map(async (task) => {
        const run = runs.find((r) => r.repo === current && r.taskKey === task.key);
        const list = await sessions.list(current, task.key);
        return {
          ...withStage(task, d),
          done: doneOf(task.status, run?.phase),
          run: run ? { phase: run.phase, stepIndex: run.stepIndex, stepStartedAt: run.stepStartedAt } : null,
          waitingPermission: list.some((s) => s.activity === "permission"),
          sessionsRunning: list.filter((s) => s.status === "running").length,
        };
      }),
    );
  });

  app.get<{ Params: { key: string } }>("/api/tasks/:key", async (req) => {
    const repo = requireRepo();
    const task = await getTask(repo, req.params.key);
    const run = (await opts.state.load()).runs.find((r) => r.repo === repo && r.taskKey === task.key);
    return { ...withStage(task, await describe(repo)), done: doneOf(task.status, run?.phase) };
  });

  app.get<{ Params: { key: string }; Querystring: { path?: string } }>("/api/tasks/:key/file", async (req) => {
    const rel = req.query.path ?? "";
    return { path: rel, content: await readTaskFile(requireRepo(), req.params.key, rel) };
  });
}
