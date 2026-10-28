import type { FastifyInstance } from "fastify";
import { credentialsMatch, LoginLimiter, SESSION_COOKIE, sessionCookie, setSessionCookie, type AuthMode, type AuthSessions, type Credentials } from "./login-sessions.js";
import { tokenMatches } from "./security.js";
import { t } from "../../core/i18n.js";
import type { AuthStatus } from "./types.js";

export interface AuthRoutesOptions {
  sessions: AuthSessions;
  /** Password mode when set. */
  login?: Credentials;
  /** The CLI's token; token mode logs in with it. */
  token?: string;
}

export function registerAuthRoutes(app: FastifyInstance, opts: AuthRoutesOptions): void {
  const mode: AuthMode = opts.login ? "password" : "token";
  // Keyed by the peer address: behind a proxy every browser shares it, so the limit is global there.
  const limiter = new LoginLimiter();

  app.get("/api/auth", async (req): Promise<AuthStatus> => ({ mode, authenticated: opts.sessions.valid(sessionCookie(req)) }));

  app.post<{ Body: { user?: unknown; password?: unknown; token?: unknown } }>("/api/login", async (req, reply) => {
    const wait = limiter.retryAfter(req.ip);
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60_000);
      return reply
        .code(429)
        .header("retry-after", Math.ceil(wait / 1000))
        .send({ error: t("auth.tooMany", { minutes }) });
    }
    const body = req.body ?? {};
    const ok = opts.login ? credentialsMatch(opts.login, body.user, body.password) : opts.token !== undefined && typeof body.token === "string" && tokenMatches(opts.token, body.token);
    if (!ok) {
      limiter.fail(req.ip);
      return reply.code(401).send({ error: opts.login ? t("auth.badLogin") : t("auth.badToken") });
    }
    limiter.succeed(req.ip);
    const session = await opts.sessions.create();
    return setSessionCookie(req, reply, session.id, session.maxAgeMs).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => {
    await opts.sessions.revoke(sessionCookie(req));
    return reply.clearCookie(SESSION_COOKIE).send({ ok: true });
  });
}
