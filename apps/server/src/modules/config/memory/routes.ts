import type { FastifyInstance } from "fastify";
import { parseConfigProvider } from "../shared/sections.js";
import type { ConfigRouteOptions } from "../shared/http.js";
import { readMemory } from "./read.js";

/** Native instruction files with their imports and checks; edited through the raw endpoints. */
export function registerMemoryRoutes(app: FastifyInstance, opts: ConfigRouteOptions) {
  const { requireRepo } = opts;
  app.get<{ Querystring: { cli?: string } }>("/api/config/memory", async (req) => readMemory(requireRepo(), parseConfigProvider(req.query.cli)));
}
