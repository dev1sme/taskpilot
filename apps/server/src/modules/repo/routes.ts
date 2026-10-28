import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import type { ProviderId } from "@taskpilot/shared";
import { claudeVersion } from "../../providers/claude/version.js";
import { copilotVersion } from "../../providers/copilot/version.js";
import { codexVersion } from "../../providers/codex/version.js";
import { HttpError } from "../../core/errors.js";
import { tasksRoot } from "../tasks/index.js";
import type { RepoContext } from "./context.js";
import { readInventory } from "./inventory.js";

/** Version of each agent's command; null when it is not installed. */
const VERSIONS: Record<ProviderId, () => Promise<string | null>> = { claude: claudeVersion, copilot: copilotVersion, codex: codexVersion };

/** The repo the UI works on; nulls before one is chosen. */
export interface RepoInfo {
  path: string | null;
  tasksDir: string | null;
  tasksDirExists: boolean;
}

/** Version of each agent's command; null when it is not installed. */
export interface ServerInfo {
  claudeVersion: string | null;
  versions: Record<ProviderId, string | null>;
}

/** The selected repo, its config inventory and the agents' versions. */
export function registerRepoRoutes(app: FastifyInstance, opts: { repo: RepoContext }) {
  const requireRepo = opts.repo.require;

  app.get("/api/repo", async (): Promise<RepoInfo> => {
    const repo = opts.repo.current();
    return {
      path: repo,
      tasksDir: repo ? tasksRoot(repo) : null,
      tasksDirExists: repo ? existsSync(tasksRoot(repo)) : false,
    };
  });

  app.put<{ Body: { path?: unknown } }>("/api/repo", async (req): Promise<RepoInfo> => {
    if (typeof req.body?.path !== "string") throw new HttpError(400, 'Body must be {"path": string}');
    const resolved = await opts.repo.set(req.body.path);
    return { path: resolved, tasksDir: tasksRoot(resolved), tasksDirExists: existsSync(tasksRoot(resolved)) };
  });

  app.get("/api/info", async (): Promise<ServerInfo> => {
    const entries = await Promise.all(Object.entries(VERSIONS).map(async ([agent, version]) => [agent, await version()] as const));
    const versions = Object.fromEntries(entries) as Record<ProviderId, string | null>;
    return { claudeVersion: versions.claude, versions };
  });

  app.get("/api/inventory", async () => readInventory(requireRepo()));
}
