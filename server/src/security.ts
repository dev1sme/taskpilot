import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export const TOKEN_HEADER = "x-taskpilot-token";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Hostname part of a Host header, port stripped. IPv6 literals keep their brackets. */
export function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end < 0 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return (colon < 0 ? host : host.slice(0, colon)).toLowerCase();
}

/** Blocks DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example. */
export function isLoopbackHost(host: string | undefined): boolean {
  return isAllowedHost(host, LOOPBACK_HOSTNAMES);
}

export function isAllowedHost(host: string | undefined, allowed: ReadonlySet<string>): boolean {
  return host !== undefined && allowed.has(hostnameOf(host));
}

export function isAllowedOrigin(origin: string, allowed: ReadonlySet<string>): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isAllowedHost(url.host, allowed);
  } catch {
    return false;
  }
}

/** Loopback names plus `extra` (hostnames without port, e.g. a reverse proxy's server_name). */
export function allowedHostnames(extra: readonly string[] = []): Set<string> {
  return new Set([...LOOPBACK_HOSTNAMES, ...extra.map((h) => hostnameOf(h.trim())).filter(Boolean)]);
}

export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface BasicAuth {
  user: string;
  password: string;
}

/** Hashing first makes the comparison constant-time regardless of the lengths involved. */
function sameSecret(expected: string, given: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(expected), digest(given));
}

export function basicAuthMatches(auth: BasicAuth, header: string | undefined): boolean {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  // Evaluate both so a wrong user takes as long as a wrong password.
  const userOk = sameSecret(auth.user, decoded.slice(0, colon));
  const passwordOk = sameSecret(auth.password, decoded.slice(colon + 1));
  return userOk && passwordOk;
}

function requestToken(req: FastifyRequest): string | undefined {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === "string") return header;
  // EventSource cannot set headers, so the SSE endpoint takes the token from the query string.
  const query = req.query as Record<string, unknown> | undefined;
  return typeof query?.token === "string" ? query.token : undefined;
}

export function registerSecurity(
  app: FastifyInstance,
  token: string,
  extraHosts: readonly string[] = [],
  auth?: BasicAuth,
): void {
  const allowed = allowedHostnames(extraHosts);
  app.addHook("onRequest", async (req, reply) => {
    if (!isAllowedHost(req.headers.host, allowed)) {
      return reply.code(403).send({ error: "Host not allowed" });
    }
    // Browsers do not apply CORS to WebSockets; refuse any cross-site page outright.
    if (req.headers.origin !== undefined && !isAllowedOrigin(req.headers.origin, allowed)) {
      return reply.code(403).send({ error: "Origin not allowed" });
    }
    // Hook callbacks come from the sessions' curl, which has its own per-session token.
    if (auth && !req.url.startsWith("/hook/") && !basicAuthMatches(auth, req.headers.authorization)) {
      return reply
        .code(401)
        .header("www-authenticate", 'Basic realm="TaskPilot", charset="UTF-8"')
        .send({ error: "Authentication required" });
    }
    if (req.url.startsWith("/api/") && !tokenMatches(token, requestToken(req))) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }
  });
}
