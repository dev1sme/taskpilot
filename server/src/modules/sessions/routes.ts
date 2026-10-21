import type { FastifyInstance } from "fastify";
import { isAgent, type Agent } from "../../core/agents.js";
import { HttpError } from "../../core/errors.js";
import type { RepoContext } from "../repo/index.js";
import { getTask, REPO_SESSION_KEY } from "../tasks/index.js";
import type { SessionManager } from "./manager.js";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sessionId(id: string): string {
  if (!SESSION_ID.test(id)) throw new HttpError(400, "Invalid session id");
  return id;
}

/** Optional `{ agent }` body of a new session; Claude when absent. */
function agentOf(body: unknown): Agent | undefined {
  const agent = typeof body === "object" && body !== null ? (body as { agent?: unknown }).agent : undefined;
  if (agent === undefined || agent === null) return undefined;
  if (!isAgent(agent)) throw new HttpError(400, `Unknown agent: ${String(agent)}`);
  return agent;
}

/** Agent sessions of a task or of the repo, and the PTY socket of each. */
export function registerSessionsRoutes(
  app: FastifyInstance,
  opts: { repo: RepoContext; sessions: SessionManager; runs: { usesSession(id: string): Promise<boolean> } },
) {
  const { sessions } = opts;
  const requireRepo = opts.repo.require;

  app.get<{ Params: { key: string } }>("/api/tasks/:key/sessions", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    return sessions.list(requireRepo(), task.key);
  });

  app.post<{ Params: { key: string } }>("/api/tasks/:key/sessions", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    return sessions.create(requireRepo(), task.key, { agent: agentOf(req.body) });
  });

  // Repo sessions: an agent in the repo without a task (the footer terminal). Not part of any workflow run.
  app.get("/api/repo/sessions", async () => sessions.list(requireRepo(), REPO_SESSION_KEY));

  app.post("/api/repo/sessions", async (req) => sessions.create(requireRepo(), REPO_SESSION_KEY, { agent: agentOf(req.body) }));

  app.post<{ Params: { id: string } }>("/api/sessions/:id/resume", async (req) =>
    sessions.resume(sessionId(req.params.id)),
  );

  app.post<{ Params: { id: string } }>("/api/sessions/:id/stop", async (req) => {
    await sessions.stop(sessionId(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    const id = sessionId(req.params.id);
    if (await opts.runs.usesSession(id)) throw new HttpError(409, "Session belongs to an active workflow run; cancel the run first");
    await sessions.forget(id);
    return { ok: true };
  });


  app.get<{ Params: { id: string } }>("/api/sessions/:id/pty", { websocket: true }, (socket, req) => {
    if (!SESSION_ID.test(req.params.id)) {
      socket.close(4400, "Invalid session id");
      return;
    }
    void sessions.attach(req.params.id, socket);
  });
}
