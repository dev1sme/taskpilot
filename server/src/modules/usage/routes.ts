import type { FastifyInstance } from "fastify";
import type { UsageStore } from "./store.js";

/** Plan usage last reported by a session's status line. */
export function registerUsageRoutes(app: FastifyInstance, opts: { usage: UsageStore }) {
  app.get("/api/usage", async () => opts.usage.view());
}
