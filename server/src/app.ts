import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { HttpError } from "./errors.js";
import path from "node:path";
import { ActivityStore } from "./activity/store.js";
import { EventHub } from "./events.js";
import { getTask, listTasks, readTaskFile, resolveRepo, tasksRoot } from "./repo/tasks.js";
import { BackupStore } from "./config/backups.js";
import { registerConfigRoutes } from "./config/routes.js";
import { EnvStore } from "./sessions/envStore.js";
import { readInventory } from "./repo/inventory.js";
import { TasksWatcher } from "./repo/watcher.js";
import { AuthSessions, type Credentials } from "./auth.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { registerSecurity } from "./security.js";
import { isHookEvent } from "./sessions/hooks.js";
import type { Launcher } from "./sessions/launch.js";
import { claudeVersion } from "./sessions/version.js";
import { SessionManager } from "./sessions/manager.js";
import type { StateStore } from "./state.js";
import { WorkflowEngine } from "./workflow/engine.js";
import type { WorkflowDef } from "./workflow/types.js";

export interface AppOptions {
  /**
   * Without `login`: the token the browser logs in with (token mode). Either way, also accepted in
   * the x-taskpilot-token header for scripts.
   */
  token?: string;
  state: StateStore;
  /** Repo given on the command line; falls back to the last repo stored in state. */
  repo?: string;
  /** Built client assets; omitted in tests and when running the Vite dev server. */
  clientDir?: string;
  logger?: boolean;
  /** Hostnames accepted in Host/Origin besides loopback, e.g. the listen address or a proxy's domain. */
  allowedHosts?: string[];
  /** Log in with a user and password (password mode) instead of the token. */
  login?: Credentials;
  /** Overrides the claude command (tests). */
  launcher?: Launcher;
  /** Overrides workflow loading (tests). */
  loadWorkflow?: (repo: string) => Promise<WorkflowDef>;
}

/** Address hook callbacks reach the server on: the listen address, or loopback when listening on all. */
function hookHost(address: string): string {
  if (address === "0.0.0.0" || address === "::") return "127.0.0.1";
  return address.includes(":") ? `[${address}]` : address;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const loginSecret = opts.login ? `password\0${opts.login.user}\0${opts.login.password}` : opts.token && `token\0${opts.token}`;
  if (!loginSecret) throw new Error("buildApp needs a token or login credentials");
  const authSessions = new AuthSessions(path.join(opts.state.dir, "auth-sessions.json"), loginSecret);
  await authSessions.load();
  // Request logging is off: SSE and WebSocket URLs carry the token in their query string.
  const app = Fastify({
    // Warnings and errors only; the CLI prints its own startup line.
    logger: opts.logger ? { level: "warn" } : false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const hub = new EventHub();
  const watcher = new TasksWatcher(() => hub.publish("tasks", { at: Date.now() }));
  const envStore = new EnvStore(opts.state.dir);
  const sessions = new SessionManager(opts.state, {
    launcher: opts.launcher,
    extraEnv: (repo) => envStore.forRepo(repo),
    hookUrl: () => {
      const addr = app.server.address();
      return addr && typeof addr === "object" ? `http://${hookHost(addr.address)}:${addr.port}/hook` : null;
    },
  });
  const engine = new WorkflowEngine(opts.state, sessions, opts.loadWorkflow);
  const logError = (e: unknown) => app.log.error(e);
  sessions.on("change", (meta) => hub.publish("sessions", { taskKey: meta.taskKey }));
  const activity = new ActivityStore(path.join(opts.state.dir, "activity"));
  activity.on("item", (item) => hub.publish("activity", item));
  sessions.on("hook", (meta, event, payload) => {
    void activity.record(meta, event, payload).catch(logError);
    void engine.onHook(meta, event, payload).catch(logError);
  });
  sessions.on("exit", (meta) => void engine.onExit(meta).catch(logError));
  engine.on("change", (run) => hub.publish("run", { taskKey: run.taskKey }));
  engine.on("warning", logError);
  await engine.recover();
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

  registerSecurity(app, { extraHosts: opts.allowedHosts, apiToken: opts.token, sessions: authSessions });
  await app.register(fastifyWebsocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  registerAuthRoutes(app, { sessions: authSessions, login: opts.login, token: opts.token });

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

  app.get("/api/info", async () => ({ claudeVersion: await claudeVersion() }));

  app.get("/api/inventory", async () => readInventory(requireRepo()));

  registerConfigRoutes(app, { requireRepo, envStore, backups: new BackupStore(path.join(opts.state.dir, "backups")) });

  app.get("/api/tasks", async () => {
    const current = requireRepo();
    const { runs } = await opts.state.load();
    return Promise.all(
      (await listTasks(current)).map(async (task) => {
        const run = runs.find((r) => r.repo === current && r.taskKey === task.key);
        const list = await sessions.list(current, task.key);
        return {
          ...task,
          run: run ? { phase: run.phase, stepIndex: run.stepIndex, stepStartedAt: run.stepStartedAt } : null,
          waitingPermission: list.some((s) => s.activity === "permission"),
          sessionsRunning: list.filter((s) => s.status === "running").length,
        };
      }),
    );
  });

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
    const id = sessionId(req.params.id);
    if (await engine.usesSession(id)) throw new HttpError(409, "Session belongs to an active workflow run; cancel the run first");
    await sessions.forget(id);
    return { ok: true };
  });

  app.get<{ Params: { key: string }; Querystring: { limit?: string } }>("/api/tasks/:key/activity", async (req) => {
    const task = await getTask(requireRepo(), req.params.key);
    const ids = (await sessions.list(requireRepo(), task.key)).map((s) => s.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 400);
    return activity.list(ids, limit);
  });

  app.get<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) =>
    engine.view(requireRepo(), (await getTask(requireRepo(), req.params.key)).key),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) =>
    engine.start(requireRepo(), (await getTask(requireRepo(), req.params.key)).key),
  );

  app.delete<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) =>
    engine.cancel(requireRepo(), req.params.key),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/approve", async (req) =>
    engine.approve(requireRepo(), req.params.key),
  );

  app.post<{ Params: { key: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/feedback", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, "Body must be {\"text\": string}");
    return engine.feedback(requireRepo(), req.params.key, req.body.text);
  });

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/retry", async (req) =>
    engine.retry(requireRepo(), req.params.key),
  );

  // Called by the hook commands injected into every session (see sessions/hooks.ts). Not under /api:
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

  app.get<{ Params: { id: string } }>("/api/sessions/:id/pty", { websocket: true }, (socket, req) => {
    if (!SESSION_ID.test(req.params.id)) {
      socket.close(4400, "Invalid session id");
      return;
    }
    void sessions.attach(req.params.id, socket);
  });

  app.get("/api/events", async (_req, reply) => hub.serve(reply));

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir });
  }

  app.addHook("onClose", async () => {
    sessions.closeAll();
    hub.close();
    await watcher.close();
  });

  return app;
}
