import type { FastifyInstance } from "fastify";
import { HttpError } from "../../core/errors.js";
import { isHookEvent, type SessionManager } from "../sessions/index.js";

/** Callbacks from inside the claude sessions TaskPilot starts: hook events and the status line. */
export function registerHooksRoutes(app: FastifyInstance, opts: { sessions: SessionManager }) {
  const { sessions } = opts;

  // Called by the hook commands injected into every session (see modules/sessions/hooks.ts). Not under /api:
  // authenticated by the per-session hook token instead of the UI token.
  app.post<{ Params: { event: string }; Body: unknown }>(
    "/hook/:event",
    { bodyLimit: 16 * 1024 * 1024 },
    async (req, reply) => {
      const token = req.headers["x-taskpilot-hook-token"];
      if (!isHookEvent(req.params.event)) throw new HttpError(404, "Unknown hook event");
      const payload = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
      if (typeof token !== "string" || !(await sessions.handleHook(token, req.params.event, payload))) {
        return reply.code(403).send({ error: "Invalid hook token" });
      }
      return { ok: true };
    },
  );

  // The status line installed with the hooks reports plan usage here; same per-session token.
  app.post("/hook/statusline", { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const token = req.headers["x-taskpilot-hook-token"];
    const payload = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    if (typeof token !== "string" || !(await sessions.handleStatusLine(token, payload))) {
      return reply.code(403).send({ error: "Invalid hook token" });
    }
    return { ok: true };
  });
}
