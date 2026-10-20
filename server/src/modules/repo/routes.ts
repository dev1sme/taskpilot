import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { claudeVersion } from "../../core/claude/version.js";
import { HttpError } from "../../core/errors.js";
import { tasksRoot } from "../tasks/scan.js";
import type { RepoContext } from "./context.js";
import { readInventory } from "./inventory.js";

/** The selected repo, its config inventory and the claude version. */
export function registerRepoRoutes(app: FastifyInstance, opts: { repo: RepoContext }) {
  const requireRepo = opts.repo.require;

  app.get("/api/repo", async () => {
    const repo = opts.repo.current();
    return {
      path: repo,
      tasksDir: repo ? tasksRoot(repo) : null,
      tasksDirExists: repo ? existsSync(tasksRoot(repo)) : false,
    };
  });

  app.put<{ Body: { path?: unknown } }>("/api/repo", async (req) => {
    if (typeof req.body?.path !== "string") throw new HttpError(400, "Body must be {\"path\": string}");
    const resolved = await opts.repo.set(req.body.path);
    return { path: resolved, tasksDir: tasksRoot(resolved), tasksDirExists: existsSync(tasksRoot(resolved)) };
  });

  app.get("/api/info", async () => ({ claudeVersion: await claudeVersion() }));

  app.get("/api/inventory", async () => readInventory(requireRepo()));
}
