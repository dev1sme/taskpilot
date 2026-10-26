import { t } from "../../core/i18n.js";
import type { FastifyInstance } from "fastify";
import type { EnvStore } from "../env/index.js";
import { registerBackupsRoutes } from "./backups/routes.js";
import { registerCodegraphRoutes } from "./codegraph/routes.js";
import { registerConfigHooksRoutes } from "./hooks/routes.js";
import { registerLibraryRoutes } from "./library/routes.js";
import { registerMcpRoutes } from "./mcp/routes.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { registerSettingsRoutes } from "./settings/routes.js";
import { registerWorkflowConfigRoutes } from "./workflow/routes.js";
import type { ConfigRouteOptions } from "./shared/http.js";
import { CONFIG_CAPABILITIES, parseConfigProvider, type ConfigSection } from "./shared/provider-capabilities.js";
import { PROVIDER_IDS } from "../../core/providers.js";
import { HttpError } from "../../core/errors.js";

function sectionOf(url: string): ConfigSection | null {
  const parts = new URL(url, "http://localhost").pathname.split("/");
  if (parts[1] !== "api" || parts[2] !== "config") return null;
  if (parts[3] === "memory" || parts[3] === "settings" || parts[3] === "hooks" || parts[3] === "agents" || parts[3] === "commands" || parts[3] === "skills" || parts[3] === "mcp") {
    if (parts[3] === "settings" && parts.includes("hooks")) return "hooks";
    if (parts[3] === "agents" && parts[4] === "templates") return null; // Existing Codex template API.
    return parts[3];
  }
  if (parts[3] === "library" && (parts[4] === "agents" || parts[4] === "commands" || parts[4] === "skills")) return parts[4];
  return null;
}

/** CLI configuration and the shared capability contract. */
export function registerConfigRoutes(app: FastifyInstance, opts: ConfigRouteOptions & { envStore: EnvStore }) {
  app.addHook("onRequest", async (req) => {
    const section = sectionOf(req.url);
    if (!section) return;
    const raw = (req.query as { cli?: unknown }).cli;
    if (raw !== undefined && typeof raw !== "string") throw new HttpError(400, t("configMessages.routes_01"));
    const cli = parseConfigProvider(raw);
    if (cli !== "claude" && !CONFIG_CAPABILITIES[cli][section].available) {
      throw new HttpError(501, CONFIG_CAPABILITIES[cli][section].reason ?? t("configMessages.routes_02", { value0: section, value1: cli }));
    }
  });
  app.get<{ Querystring: { cli?: string } }>("/api/config/capabilities", async (req) => {
    const cli = parseConfigProvider(req.query.cli);
    return { cli, clis: PROVIDER_IDS, sections: CONFIG_CAPABILITIES[cli] };
  });
  registerMcpRoutes(app, opts);
  registerMemoryRoutes(app, opts);
  registerSettingsRoutes(app, opts);
  registerConfigHooksRoutes(app, opts);
  registerLibraryRoutes(app, opts);
  registerCodegraphRoutes(app, opts);
  registerWorkflowConfigRoutes(app, opts);
  registerBackupsRoutes(app, opts);
}
