import type { FastifyInstance } from "fastify";
import { HttpError } from "../../core/errors.js";
import type { RepoContext } from "../repo/index.js";
import { getTask } from "../tasks/index.js";
import type { WorkflowEngine } from "./engine.js";

/** Workflow run of a task: view, start, cancel, approve a gate, send feedback, answer Claude, restart, retry; reply to or retry one subtask. */
/** The optional `{mode}` of a run request: a workflows/ directory or "custom"; the engine rejects an unknown one. */
function modeOf(body: unknown): string | undefined {
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (mode === undefined || mode === null) return undefined;
  if (typeof mode !== "string") throw new HttpError(400, "Body must be {\"mode\"?: string}");
  return mode;
}

export function registerWorkflowRoutes(app: FastifyInstance, opts: { repo: RepoContext; engine: WorkflowEngine }) {
  const { engine } = opts;
  const requireRepo = opts.repo.require;

  app.get<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) =>
    engine.view(requireRepo(), (await getTask(requireRepo(), req.params.key)).key),
  );

  app.post<{ Params: { key: string }; Body: { mode?: unknown } | null }>("/api/tasks/:key/run", async (req) =>
    engine.start(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, modeOf(req.body)),
  );

  app.delete<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) =>
    engine.cancel(requireRepo(), req.params.key),
  );

  app.post<{ Params: { key: string }; Body: { note?: unknown } | null }>("/api/tasks/:key/run/approve", async (req) => {
    const note = req.body?.note;
    if (note !== undefined && typeof note !== "string") throw new HttpError(400, "Body must be {\"note\"?: string}");
    return engine.approve(requireRepo(), req.params.key, note);
  });

  app.post<{ Params: { key: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/feedback", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, "Body must be {\"text\": string}");
    return engine.feedback(requireRepo(), req.params.key, req.body.text);
  });

  app.post<{ Params: { key: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/reply", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, "Body must be {\"text\": string}");
    return engine.reply(requireRepo(), req.params.key, req.body.text);
  });

  app.post<{ Params: { key: string; n: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/subtasks/:n/reply", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, "Body must be {\"text\": string}");
    return engine.replySubtask(requireRepo(), req.params.key, Number(req.params.n), req.body.text);
  });

  app.post<{ Params: { key: string; n: string } }>("/api/tasks/:key/run/subtasks/:n/retry", async (req) =>
    engine.retrySubtask(requireRepo(), req.params.key, Number(req.params.n)),
  );

  app.post<{ Params: { key: string }; Body: { mode?: unknown } | null }>("/api/tasks/:key/run/restart", async (req) =>
    engine.restart(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, modeOf(req.body)),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/retry", async (req) =>
    engine.retry(requireRepo(), req.params.key),
  );
}
