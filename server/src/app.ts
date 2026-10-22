import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Agent } from "./core/agents.js";
import type { Launcher } from "./core/claude/launch.js";
import type { CopilotQuotaResult } from "./core/copilot/quota.js";
import { HttpError } from "./core/errors.js";
import { EventHub } from "./core/events.js";
import type { StateStore } from "./core/state.js";
import { registerActivityRoutes, ActivityStore } from "./modules/activity/index.js";
import { registerAuthRoutes, registerSecurity, AuthSessions, type Credentials } from "./modules/auth/index.js";
import { BackupStore, registerConfigRoutes, statusLineCommand, subagentsOf } from "./modules/config/index.js";
import { registerEnvRoutes, EnvStore } from "./modules/env/index.js";
import { registerEventsRoutes } from "./modules/events/index.js";
import { registerHooksRoutes } from "./modules/hooks/index.js";
import { createRepoContext, registerRepoRoutes } from "./modules/repo/index.js";
import { SessionManager, registerSessionsRoutes } from "./modules/sessions/index.js";
import { registerTasksRoutes, TasksWatcher } from "./modules/tasks/index.js";
import { CopilotQuotaPoller, registerUsageRoutes, UsageStore } from "./modules/usage/index.js";
import { WorkflowEngine, loadWorkflow, readRepoSettings, type LoadDef, registerWorkflowRoutes, stageOf } from "./modules/workflow/index.js";

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
  /** Overrides how often and how patiently a hookless session's transcript is read (tests). */
  transcript?: { pollMs: number; idleMs: number };
  /** Overrides workflow loading (tests). */
  loadWorkflow?: LoadDef;
  /** Overrides reading Copilot's account quota (tests). */
  copilotQuota?: () => Promise<CopilotQuotaResult>;
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
    transcriptPollMs: opts.transcript?.pollMs,
    transcriptIdleMs: opts.transcript?.idleMs,
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
  /** A mode's workflow; the repo's own choice (.taskpilot/settings.yml) when `mode` is absent. */
  const loadDef: LoadDef = opts.loadWorkflow ?? (async (r, mode) => loadWorkflow(r, mode, (await readRepoSettings(r)).mode));
  // The engine checks the plan's subagents and lists them to the leader; config reads them.
  const engine = new WorkflowEngine(opts.state, sessions, loadDef, subagentsOf);
  const logError = (e: unknown) => app.log.error(e);
  sessions.on("change", (meta) => hub.publish("sessions", { taskKey: meta.taskKey }));
  const activity = new ActivityStore(path.join(opts.state.dir, "activity"));
  activity.on("item", (item) => hub.publish("activity", item));
  sessions.on("hook", (meta, event, payload) => {
    void activity.record(meta, event, payload).catch(logError);
    void engine.onHook(meta, event, payload).catch(logError);
  });
  sessions.on("exit", (meta) => void engine.onExit(meta).catch(logError));
  sessions.on("metrics", (meta, data) => void engine.onMetrics(meta, data).catch(logError));
  sessions.on("warning", logError);
  const usage = new UsageStore(opts.state);
  // Claude's plan usage comes from its status line; copilot's status line input has no account
  // quota (TPL-009 spike), so copilot's is read from its runtime: when a session is ready, while
  // it works and when a turn ends. The poller limits reads to one a minute.
  sessions.on("statusline", (meta, payload) => {
    if ((meta.agent ?? "claude") === "claude") void usage.apply(payload).catch(logError);
    // A subtask's model and cost, for the leader's review of the subtasks.
    void engine.onStatusLine(meta, payload).catch(logError);
  });
  const copilotQuota = new CopilotQuotaPoller(usage, opts.copilotQuota, logError);
  sessions.on("hook", (meta, event) => {
    if (meta.agent === "copilot" && (event === "SessionStart" || event === "PostToolUse" || event === "Stop")) copilotQuota.request();
  });
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
  registerConfigRoutes(app, { requireRepo: repo.require, state: opts.state, envStore, backups: new BackupStore(path.join(opts.state.dir, "backups")) });
  registerEnvRoutes(app, { requireRepo: repo.require, envStore });
  registerTasksRoutes(app, {
    repo,
    state: opts.state,
    sessions,
    describe: async (r) => {
      const def = await loadDef(r);
      const { runs } = await opts.state.load();
      // A task follows the workflow its latest run started with, whatever mode that was.
      const of = (key: string) => runs.find((run) => run.repo === r && run.taskKey === key)?.workflow ?? def;
      return { stageOf: (files, key) => stageOf(of(key), files), historyFile: def.history.file };
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
    copilotQuota.stop();
    sessions.closeAll();
    hub.close();
    await watcher.close();
  });

  return app;
}
