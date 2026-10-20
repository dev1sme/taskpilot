import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface Credentials {
  user: string;
  password: string;
}

/** "password": log in with Credentials. "token": log in with the token the CLI prints. */
export type AuthMode = "password" | "token";

export const SESSION_COOKIE = "taskpilot_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (v: string) => createHash("sha256").update(v).digest();

/** Hashing first makes the comparison constant-time regardless of the lengths involved. */
export function sameSecret(expected: string, given: string): boolean {
  return timingSafeEqual(sha256(expected), sha256(given));
}

export function credentialsMatch(expected: Credentials, user: unknown, password: unknown): boolean {
  if (typeof user !== "string" || typeof password !== "string") return false;
  // Evaluate both so a wrong user takes as long as a wrong password.
  const userOk = sameSecret(expected.user, user);
  const passwordOk = sameSecret(expected.password, password);
  return userOk && passwordOk;
}

interface StoredSession {
  /** sha256 of the cookie value: a leaked file does not hand out live sessions. */
  hash: string;
  expires: number;
  /** Fingerprint of the login secret at creation; changing the password or token logs everyone out. */
  secret: string;
}

/** Login sessions, persisted so a service restart does not log the browser out. */
export class AuthSessions {
  private sessions = new Map<string, StoredSession>();
  private readonly secret: string;

  constructor(
    private readonly file: string,
    loginSecret: string,
  ) {
    this.secret = sha256(loginSecret).toString("hex");
  }

  async load(): Promise<void> {
    let stored: StoredSession[];
    try {
      stored = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      return;
    }
    const now = Date.now();
    for (const s of Array.isArray(stored) ? stored : []) {
      if (s?.secret === this.secret && typeof s.hash === "string" && s.expires > now) this.sessions.set(s.hash, s);
    }
  }

  async create(): Promise<{ id: string; maxAgeMs: number }> {
    const id = randomBytes(32).toString("base64url");
    const hash = sha256(id).toString("hex");
    this.sessions.set(hash, { hash, expires: Date.now() + SESSION_TTL_MS, secret: this.secret });
    await this.save();
    return { id, maxAgeMs: SESSION_TTL_MS };
  }

  valid(id: string | undefined): boolean {
    if (!id) return false;
    const hash = sha256(id).toString("hex");
    const s = this.sessions.get(hash);
    if (!s) return false;
    if (s.expires > Date.now()) return true;
    this.sessions.delete(hash);
    return false;
  }

  async revoke(id: string | undefined): Promise<void> {
    if (id && this.sessions.delete(sha256(id).toString("hex"))) await this.save();
  }

  private async save(): Promise<void> {
    const now = Date.now();
    const live = [...this.sessions.values()].filter((s) => s.expires > now);
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(live), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}

/**
 * Locks a client out for `windowMs` after `max` failed logins. In memory: a restart clears it.
 * Not @fastify/rate-limit: it counts every request and cannot reset a client on a good login,
 * and the Retry-After header it would add is already sent by the login route.
 */
export class LoginLimiter {
  private failures = new Map<string, { count: number; first: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** Milliseconds until `key` may try again; 0 when it may try now. */
  retryAfter(key: string, now = Date.now()): number {
    const f = this.failures.get(key);
    if (!f) return 0;
    if (now - f.first >= this.windowMs) {
      this.failures.delete(key);
      return 0;
    }
    return f.count >= this.max ? f.first + this.windowMs - now : 0;
  }

  fail(key: string, now = Date.now()): void {
    const f = this.failures.get(key);
    if (!f || now - f.first >= this.windowMs) this.failures.set(key, { count: 1, first: now });
    else f.count++;
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

/** Needs @fastify/cookie registered before any hook that calls it. */
export function sessionCookie(req: FastifyRequest): string | undefined {
  return req.cookies[SESSION_COOKIE];
}

/** `Secure` whenever the browser is on https, including behind a TLS-terminating proxy. */
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, value: string, maxAgeMs: number): FastifyReply {
  // The plugin's `secure: "auto"` only sees req.protocol, which ignores x-forwarded-proto without trustProxy.
  const secure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  return reply.setCookie(SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    maxAge: Math.floor(maxAgeMs / 1000),
    secure,
  });
}
