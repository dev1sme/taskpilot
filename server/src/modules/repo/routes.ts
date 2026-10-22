import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import type { Agent } from "../../core/agents.js";
import { claudeVersion } from "../../core/claude/version.js";
import { copilotVersion } from "../../core/copilot/version.js";
import { codexVersion } from "../../core/codex/version.js";
import { HttpError } from "../../core/errors.js";
import { tasksRoot } from "../tasks/index.js";
import type { RepoContext } from "./context.js";
import { readInventory } from "./inventory.js";

/** Version of each agent's command; null when it is not installed. */
const VERSIONS: Record<Agent, () => Promise<string | null>> = { claude: claudeVersion, copilot: copilotVersion, codex: codexVersion };

/** The selected repo, its config inventory and the agents' versions. */
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
    if (typeof req.body?.path !== "string") throw new HttpError(400, 'Body must be {"path": string}');
    const resolved = await opts.repo.set(req.body.path);
    return { path: resolved, tasksDir: tasksRoot(resolved), tasksDirExists: existsSync(tasksRoot(resolved)) };
  });

  app.get("/api/info", async () => {
    const entries = await Promise.all(Object.entries(VERSIONS).map(async ([agent, version]) => [agent, await version()] as const));
    const versions = Object.fromEntries(entries) as Record<Agent, string | null>;
    return { claudeVersion: versions.claude, versions };
  });

  app.get("/api/inventory", async () => readInventory(requireRepo()));
}
