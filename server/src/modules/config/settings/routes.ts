import type { FastifyInstance } from "fastify";
import { parseConfigProvider } from "../shared/sections.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { nativeSettingsOf } from "./native.js";
import { readNativeSettings, readSettings } from "./read.js";

/** Settings files as Claude's permissions and env, or another CLI's native fields; edited through the raw endpoints. */
export function registerSettingsRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo } = opts;
  app.get<{ Querystring: { cli?: string } }>("/api/config/settings", async (req) => {
    const native = nativeSettingsOf(parseConfigProvider(req.query.cli));
    return native ? readNativeSettings(requireRepo(), native) : readSettings(requireRepo());
  });
}
