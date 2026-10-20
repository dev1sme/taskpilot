import type { FastifyInstance } from "fastify";
import type { StateStore } from "../../core/state.js";
import type { RepoContext } from "../repo/index.js";
import type { SessionManager } from "../sessions/index.js";
import { getTask, listTasks, readTaskFile } from "./scan.js";

/** Tasks of the current repo, with their run phase and sessions, and the files inside a task. */
export function registerTasksRoutes(app: FastifyInstance, opts: { repo: RepoContext; state: StateStore; sessions: SessionManager }) {
  const { sessions } = opts;
  const requireRepo = opts.repo.require;

  app.get("/api/tasks", async () => {
    const current = requireRepo();
    const { runs } = await opts.state.load();
    return Promise.all(
      (await listTasks(current)).map(async (task) => {
        const run = runs.find((r) => r.repo === current && r.taskKey === task.key);
        const list = await sessions.list(current, task.key);
        return {
          ...task,
          run: run ? { phase: run.phase, stepIndex: run.stepIndex, stepStartedAt: run.stepStartedAt } : null,
          waitingPermission: list.some((s) => s.activity === "permission"),
          sessionsRunning: list.filter((s) => s.status === "running").length,
        };
      }),
    );
  });

  app.get<{ Params: { key: string } }>("/api/tasks/:key", async (req) => getTask(requireRepo(), req.params.key));

  app.get<{ Params: { key: string }; Querystring: { path?: string } }>("/api/tasks/:key/file", async (req) => {
    const rel = req.query.path ?? "";
    return { path: rel, content: await readTaskFile(requireRepo(), req.params.key, rel) };
  });
}
