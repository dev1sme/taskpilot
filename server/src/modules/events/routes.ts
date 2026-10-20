import type { FastifyInstance } from "fastify";
import type { EventHub } from "../../core/events.js";

/** Server-sent events the UI listens to (tasks, sessions, run, activity, usage, repo). */
export function registerEventsRoutes(app: FastifyInstance, opts: { hub: EventHub }) {
  app.get("/api/events", async (_req, reply) => opts.hub.serve(reply));
}
