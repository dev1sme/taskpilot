import type { FastifyInstance } from "fastify";
import type { EnvStore } from "../env/store.js";
import { registerBackupsRoutes } from "./backups/routes.js";
import { registerCodegraphRoutes } from "./codegraph/routes.js";
import { registerHooksRoutes } from "./hooks/routes.js";
import { registerLibraryRoutes } from "./library/routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import type { ConfigRouteOptions } from "./shared/http.js";

/** Claude configuration: reads (phase B), and edits with diff preview, backups and conflict checks (phase C). */
export function registerConfigRoutes(app: FastifyInstance, opts: ConfigRouteOptions & { envStore: EnvStore }) {
  registerMcpRoutes(app, opts);
  registerMemoryRoutes(app, opts);
  registerSettingsRoutes(app, opts);
  registerHooksRoutes(app, opts);
  registerLibraryRoutes(app, opts);
  registerCodegraphRoutes(app, opts);
  registerBackupsRoutes(app, opts);
}
