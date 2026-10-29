import type { FastifyInstance } from "fastify";
import { configAdapter } from "../adapters/index.js";
import { readHooks } from "../settings/read.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { parseConfigProvider } from "../shared/sections.js";
import { listHookFiles } from "./hook-files.js";
import { listScopeHookFiles } from "./scope-files.js";

/** Hook commands: Claude's from its settings files, Copilot's from its hook files, Codex's from hooks.json; edited through the raw endpoints. */
export function registerConfigHooksRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo } = opts;
  app.get<{ Querystring: { cli?: string } }>("/api/config/hooks", async (req) => {
    const cli = parseConfigProvider(req.query.cli);
    const hooks = configAdapter(cli).hooks;
    if (hooks?.kind === "files") return listHookFiles(requireRepo(), cli, hooks);
    if (hooks?.kind === "file") return listScopeHookFiles(requireRepo(), cli, hooks);
    return readHooks(requireRepo());
  });
}
