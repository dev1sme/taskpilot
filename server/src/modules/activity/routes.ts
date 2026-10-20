import type { FastifyInstance } from "fastify";
import type { RepoContext } from "../repo/context.js";
import type { SessionManager } from "../sessions/manager.js";
import { getTask } from "../tasks/scan.js";
import type { ActivityStore } from "./store.js";

/** Activity feed of a task: hook events of all its sessions. */
export function registerActivityRoutes(app: FastifyInstance, opts: { repo: RepoContext; sessions: SessionManager; activity: ActivityStore }) {
  const { sessions, activity } = opts;
  const requireRepo = opts.repo.require;

  app.get<{ Params: { key: string }; Querystring: { limit?: string } }>("/api/tasks/:key/activity", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    const ids = (await sessions.list(requireRepo(), task.key)).map((s) => s.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 400);
    return activity.list(ids, limit);
  });
}
