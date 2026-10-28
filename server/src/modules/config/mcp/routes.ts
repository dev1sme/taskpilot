import type { FastifyInstance } from "fastify";
import { HttpError } from "../../../core/errors.js";
import type { EnvStore } from "../../env/index.js";
import { checkMcp } from "../../../providers/claude/commands.js";
import { NAME, readMcp } from "./read.js";
import { t } from "../../../core/i18n.js";
import { parseConfigProvider } from "../shared/sections.js";
import { configAdapter } from "../adapters/index.js";

/**
 * MCP servers of every scope, secrets masked. Files are edited through the raw endpoints; Claude's
 * local and user servers live in ~/.claude.json, which Claude Code rewrites itself, and are only shown.
 */
export function registerMcpRoutes(app: FastifyInstance, opts: { requireRepo: () => string; envStore: EnvStore }) {
  const { requireRepo, envStore } = opts;

  app.get<{ Querystring: { cli?: string } }>("/api/config/mcp", async (req) => {
    const repo = requireRepo();
    return readMcp(repo, await envStore.forRepo(repo), parseConfigProvider(req.query.cli));
  });

  /** Connection status as Claude reports it (`claude mcp get`); only the status is returned. */
  app.post<{ Params: { name: string }; Querystring: { cli?: string } }>("/api/config/mcp/check/:name", async (req) => {
    const repo = requireRepo();
    if (configAdapter(parseConfigProvider(req.query.cli)).mcp.kind !== "claude") throw new HttpError(501, t("configMessages.mcp_routes_01"));
    if (!NAME.test(req.params.name)) throw new HttpError(400, t("mcp.invalidServerName"));
    return checkMcp(req.params.name, { cwd: repo, env: await envStore.forRepo(repo) });
  });
}
