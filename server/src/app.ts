import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { HttpError } from "./errors.js";
import { EventHub } from "./events.js";
import { getTask, listTasks, readTaskFile, resolveRepo, tasksRoot } from "./repo/tasks.js";
import { TasksWatcher } from "./repo/watcher.js";
import { registerSecurity } from "./security.js";
import type { Launcher } from "./sessions/launch.js";
import { SessionManager } from "./sessions/manager.js";
import type { StateStore } from "./state.js";

export interface AppOptions {
  token: string;
  state: StateStore;
  /** Repo given on the command line; falls back to the last repo stored in state. */
  repo?: string;
  /** Built web assets; omitted in tests and when running the Vite dev server. */
  webDir?: string;
  logger?: boolean;
  /** Overrides the claude command (tests). */
  launcher?: Launcher;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  // Request logging is off: SSE and WebSocket URLs carry the token in their query string.
  const app = Fastify({
    logger: opts.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const hub = new EventHub();
  const watcher = new TasksWatcher(() => hub.publish("tasks", { at: Date.now() }));
  const sessions = new SessionManager(opts.state, {
    launcher: opts.launcher,
    onChange: (meta) => hub.publish("sessions", { taskKey: meta.taskKey }),
  });
  let repo: string | null = null;

  async function setRepo(input: string): Promise<string> {
    const resolved = await resolveRepo(input);
    repo = resolved;
    await watcher.watch(resolved);
    await opts.state.update((s) => {
      s.lastRepo = resolved;
    });
    hub.publish("repo", { path: resolved });
    return resolved;
  }

  function requireRepo(): string {
    if (!repo) throw new HttpError(409, "No repo selected");
    return repo;
  }

  function sessionId(id: string): string {
    if (!SESSION_ID.test(id)) throw new HttpError(400, "Invalid session id");
    return id;
  }

  const initial = opts.repo ?? (await opts.state.load()).lastRepo;
  if (initial) {
    try {
      await setRepo(initial);
    } catch (e) {
      app.log.warn(`Ignoring repo ${initial}: ${(e as Error).message}`);
    }
  }

  registerSecurity(app, opts.token);
  await app.register(fastifyWebsocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  app.get("/api/repo", async () => ({
    path: repo,
    tasksDir: repo ? tasksRoot(repo) : null,
    tasksDirExists: repo ? existsSync(tasksRoot(repo)) : false,
  }));

  app.put<{ Body: { path?: unknown } }>("/api/repo", async (req) => {
    if (typeof req.body?.path !== "string") throw new HttpError(400, "Body must be {\"path\": string}");
    const resolved = await setRepo(req.body.path);
    return { path: resolved, tasksDir: tasksRoot(resolved), tasksDirExists: existsSync(tasksRoot(resolved)) };
  });

  app.get("/api/tasks", async () => listTasks(requireRepo()));

  app.get<{ Params: { key: string } }>("/api/tasks/:key", async (req) => getTask(requireRepo(), req.params.key));

  app.get<{ Params: { key: string }; Querystring: { path?: string } }>("/api/tasks/:key/file", async (req) => {
    const rel = req.query.path ?? "";
    return { path: rel, content: await readTaskFile(requireRepo(), req.params.key, rel) };
  });

  app.get<{ Params: { key: string } }>("/api/tasks/:key/sessions", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    return sessions.list(requireRepo(), task.key);
  });

  app.post<{ Params: { key: string } }>("/api/tasks/:key/sessions", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    return sessions.create(requireRepo(), task.key);
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/resume", async (req) =>
    sessions.resume(sessionId(req.params.id)),
  );

  app.post<{ Params: { id: string } }>("/api/sessions/:id/stop", async (req) => {
    await sessions.stop(sessionId(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    await sessions.forget(sessionId(req.params.id));
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/pty", { websocket: true }, (socket, req) => {
    if (!SESSION_ID.test(req.params.id)) {
      socket.close(4400, "Invalid session id");
      return;
    }
    void sessions.attach(req.params.id, socket);
  });

  app.get("/api/events", async (_req, reply) => hub.serve(reply));

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir });
  }

  app.addHook("onClose", async () => {
    sessions.closeAll();
    hub.close();
    await watcher.close();
  });

  return app;
}
