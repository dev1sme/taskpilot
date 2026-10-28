import type { FastifyInstance } from "fastify";
import type { ConfigRouteOptions } from "../shared/http.js";
import { getCodegraphStatus, runCodegraphIndex } from "./status.js";

/** Codegraph index status of the repo. */
export function registerCodegraphRoutes(app: FastifyInstance, opts: Pick<ConfigRouteOptions, "requireRepo">) {
  const { requireRepo } = opts;
  app.get("/api/config/codegraph", async () => getCodegraphStatus(requireRepo()));
  app.post("/api/config/codegraph/index", async () => runCodegraphIndex(requireRepo()));
}
