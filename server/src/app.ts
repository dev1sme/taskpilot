import fastifyStatic from "@fastify/static";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { HttpError } from "./errors.js";
import { EventHub } from "./events.js";
import { getTask, listTasks, readTaskFile, resolveRepo, tasksRoot } from "./repo/tasks.js";
import { TasksWatcher } from "./repo/watcher.js";
import { registerSecurity } from "./security.js";
import type { StateStore } from "./state.js";

export interface AppOptions {
  token: string;
  state: StateStore;
  /** Repo given on the command line; falls back to the last repo stored in state. */
  repo?: string;
  /** Built web assets; omitted in tests and when running the Vite dev server. */
  webDir?: string;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  // Request logging is off: the SSE URL carries the token in its query string.
  const app = Fastify({
    logger: opts.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const hub = new EventHub();
  const watcher = new TasksWatcher(() => hub.publish("tasks", { at: Date.now() }));
  let repo: string | null = null;

  async function setRepo(input: string): Promise<string> {
    const resolved = await resolveRepo(input);
    repo = resolved;
    await watcher.watch(resolved);
    await opts.state.save({ ...(await opts.state.load()), lastRepo: resolved });
    hub.publish("repo", { path: resolved });
    return resolved;
  }

  function requireRepo(): string {
    if (!repo) throw new HttpError(409, "No repo selected");
    return repo;
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

  app.get("/api/events", async (_req, reply) => hub.serve(reply));

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir });
  }

  app.addHook("onClose", async () => {
    hub.close();
    await watcher.close();
  });

  return app;
}
