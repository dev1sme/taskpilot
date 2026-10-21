import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Agent } from "./core/agents.js";
import type { Launcher } from "./core/claude/launch.js";
import { HttpError } from "./core/errors.js";
import { EventHub } from "./core/events.js";
import type { StateStore } from "./core/state.js";
import { registerActivityRoutes, ActivityStore } from "./modules/activity/index.js";
import { registerAuthRoutes, registerSecurity, AuthSessions, type Credentials } from "./modules/auth/index.js";
import { BackupStore, registerConfigRoutes, statusLineCommand } from "./modules/config/index.js";
import { registerEnvRoutes, EnvStore } from "./modules/env/index.js";
import { registerEventsRoutes } from "./modules/events/index.js";
import { registerHooksRoutes } from "./modules/hooks/index.js";
import { createRepoContext, registerRepoRoutes } from "./modules/repo/index.js";
import { SessionManager, registerSessionsRoutes } from "./modules/sessions/index.js";
import { registerTasksRoutes, TasksWatcher } from "./modules/tasks/index.js";
import { registerUsageRoutes, UsageStore } from "./modules/usage/index.js";
import { WorkflowEngine, loadWorkflow, registerWorkflowRoutes, stageOf, type WorkflowDef } from "./modules/workflow/index.js";

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
  /** Overrides an agent's command (tests). */
  launchers?: Partial<Record<Agent, Launcher>>;
  /** Overrides workflow loading (tests). */
  loadWorkflow?: (repo: string) => Promise<WorkflowDef>;
}

/** Address hook callbacks reach the server on: the listen address, or loopback when listening on all. */
function hookHost(address: string): string {
  if (address === "0.0.0.0" || address === "::") return "127.0.0.1";
  return address.includes(":") ? `[${address}]` : address;
}

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
    launchers: opts.launchers,
    extraEnv: async (repo) => {
      // The status line TaskPilot installs runs the user's own one after reporting usage.
      const statusLine = await statusLineCommand(repo).catch(() => null);
      return { ...(await envStore.forRepo(repo)), ...(statusLine ? { TASKPILOT_STATUSLINE_CMD: statusLine } : {}) };
    },
    hookUrl: () => {
      const addr = app.server.address();
      return addr && typeof addr === "object" ? `http://${hookHost(addr.address)}:${addr.port}/hook` : null;
    },
  });
  const loadDef = opts.loadWorkflow ?? loadWorkflow;
  const engine = new WorkflowEngine(opts.state, sessions, loadDef);
  const logError = (e: unknown) => app.log.error(e);
  sessions.on("change", (meta) => hub.publish("sessions", { taskKey: meta.taskKey }));
  const activity = new ActivityStore(path.join(opts.state.dir, "activity"));
  activity.on("item", (item) => hub.publish("activity", item));
  sessions.on("hook", (meta, event, payload) => {
    void activity.record(meta, event, payload).catch(logError);
    void engine.onHook(meta, event, payload).catch(logError);
  });
  sessions.on("exit", (meta) => void engine.onExit(meta).catch(logError));
  sessions.on("warning", logError);
  const usage = new UsageStore(opts.state);
  sessions.on("statusline", (_meta, payload) => void usage.apply(payload).catch(logError));
  usage.on("change", (view) => hub.publish("usage", view));
  engine.on("change", (run) => hub.publish("run", { taskKey: run.taskKey }));
  engine.on("warning", logError);
  await engine.recover();
  const repo = createRepoContext({ watcher, state: opts.state, hub });

  const initial = opts.repo ?? (await opts.state.load()).lastRepo;
  if (initial) {
    try {
      await repo.set(initial);
    } catch (e) {
      app.log.warn(`Ignoring repo ${initial}: ${(e as Error).message}`);
    }
  }

  // Parses cookies in an onRequest hook, which must run before the session check registerSecurity adds.
  await app.register(fastifyCookie);
  registerSecurity(app, { extraHosts: opts.allowedHosts, apiToken: opts.token, sessions: authSessions });
  await app.register(fastifyWebsocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  registerAuthRoutes(app, { sessions: authSessions, login: opts.login, token: opts.token });
  registerRepoRoutes(app, { repo });
  registerUsageRoutes(app, { usage });
  registerConfigRoutes(app, { requireRepo: repo.require, envStore, backups: new BackupStore(path.join(opts.state.dir, "backups")) });
  registerEnvRoutes(app, { requireRepo: repo.require, envStore });
  registerTasksRoutes(app, {
    repo,
    state: opts.state,
    sessions,
    describe: async (r) => {
      const def = await loadDef(r);
      return { stageOf: (files) => stageOf(def, files), historyFile: def.history.file };
    },
  });
  registerSessionsRoutes(app, { repo, sessions, runs: engine });
  registerActivityRoutes(app, { repo, sessions, activity });
  registerWorkflowRoutes(app, { repo, engine });
  registerHooksRoutes(app, { sessions });
  registerEventsRoutes(app, { hub });

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
