import type { FastifyInstance } from "fastify";
import { HttpError } from "../../core/errors.js";
import type { RepoContext } from "../repo/index.js";
import { getTask } from "../tasks/index.js";
import type { RunOptions, WorkflowEngine } from "./engine.js";
import { parseExecution } from "./execution.js";
import { parseHandoffRequest } from "./handoff.js";

/** Workflow run of a task: view, start, cancel, approve a gate, send feedback, answer Claude, restart, retry, mark a step done; reply to, retry or mark done one subtask; mark the task done or open. */
/** Independent mode/execution choices; old mode-only and empty requests still work. */
const RUN_OPTION_KEYS = new Set(["mode", "execution", "isolation", "acceptDirtyBase"]);

function optionsOf(body: unknown): RunOptions {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !RUN_OPTION_KEYS.has(key)))
    throw new HttpError(400, "Body must contain mode/execution/isolation options");
  const { mode, execution, isolation, acceptDirtyBase } = body as { mode?: unknown; execution?: unknown; isolation?: unknown; acceptDirtyBase?: unknown };
  if (isolation !== undefined && isolation !== "repo" && isolation !== "worktree") throw new HttpError(400, 'isolation must be "repo" or "worktree"');
  if (acceptDirtyBase !== undefined && typeof acceptDirtyBase !== "boolean") throw new HttpError(400, "acceptDirtyBase must be a boolean");
  const options: RunOptions = {
    ...(execution === undefined ? {} : { execution: parseExecution(execution) }),
    ...(isolation === undefined ? {} : { isolation }),
    ...(acceptDirtyBase === undefined ? {} : { acceptDirtyBase }),
  };
  if (mode === undefined || mode === null) return options;
  if (typeof mode !== "string") throw new HttpError(400, 'Body must be {"mode"?: string}');
  return { ...options, mode };
}

export function registerWorkflowRoutes(app: FastifyInstance, opts: { repo: RepoContext; engine: WorkflowEngine }) {
  const { engine } = opts;
  const requireRepo = opts.repo.require;

  app.get<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) => engine.view(requireRepo(), (await getTask(requireRepo(), req.params.key)).key));

  app.post<{ Params: { key: string }; Body: { mode?: unknown; execution?: unknown } | null }>("/api/tasks/:key/run", async (req) =>
    engine.start(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, optionsOf(req.body)),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/preview", async (req) => engine.preview(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, optionsOf(req.body)));

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/handoff/preview", async (req) =>
    engine.previewHandoff(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, parseHandoffRequest(req.body)),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/handoff", async (req) =>
    engine.commitHandoff(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, parseHandoffRequest(req.body, true)),
  );

  app.delete<{ Params: { key: string } }>("/api/tasks/:key/run", async (req) => engine.cancel(requireRepo(), req.params.key));

  app.post<{ Params: { key: string }; Body: { note?: unknown } | null }>("/api/tasks/:key/run/approve", async (req) => {
    const note = req.body?.note;
    if (note !== undefined && typeof note !== "string") throw new HttpError(400, 'Body must be {"note"?: string}');
    return engine.approve(requireRepo(), req.params.key, note);
  });

  app.post<{ Params: { key: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/feedback", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, 'Body must be {"text": string}');
    return engine.feedback(requireRepo(), req.params.key, req.body.text);
  });

  app.post<{ Params: { key: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/reply", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, 'Body must be {"text": string}');
    return engine.reply(requireRepo(), req.params.key, req.body.text);
  });

  app.post<{ Params: { key: string; n: string }; Body: { text?: unknown } }>("/api/tasks/:key/run/subtasks/:n/reply", async (req) => {
    if (typeof req.body?.text !== "string") throw new HttpError(400, 'Body must be {"text": string}');
    return engine.replySubtask(requireRepo(), req.params.key, Number(req.params.n), req.body.text);
  });

  app.post<{ Params: { key: string; n: string } }>("/api/tasks/:key/run/subtasks/:n/retry", async (req) => engine.retrySubtask(requireRepo(), req.params.key, Number(req.params.n)));

  app.post<{ Params: { key: string; n: string } }>("/api/tasks/:key/run/subtasks/:n/complete", async (req) => engine.completeSubtask(requireRepo(), req.params.key, Number(req.params.n)));

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/complete", async (req) => engine.completeStep(requireRepo(), req.params.key));

  app.post<{ Params: { key: string }; Body: { mode?: unknown; execution?: unknown } | null }>("/api/tasks/:key/run/restart", async (req) =>
    engine.restart(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, optionsOf(req.body)),
  );

  app.post<{ Params: { key: string } }>("/api/tasks/:key/run/retry", async (req) => engine.retry(requireRepo(), req.params.key));

  // A run's own worktree: whether one can be made, what is in it, and the user's integrate/remove actions.
  app.get<{ Params: { key: string } }>("/api/tasks/:key/run/worktree-check", async (req) => {
    await getTask(requireRepo(), req.params.key);
    return engine.worktreeCheck(requireRepo());
  });

  app.get<{ Params: { key: string } }>("/api/tasks/:key/workspaces", async (req) => engine.workspaces(requireRepo(), (await getTask(requireRepo(), req.params.key)).key));

  app.get<{ Params: { key: string; runId: string } }>("/api/tasks/:key/workspaces/:runId/diff", async (req) =>
    engine.workspaceDiff(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, req.params.runId),
  );

  app.post<{ Params: { key: string; runId: string }; Body: { commit?: unknown } | null }>("/api/tasks/:key/workspaces/:runId/integrate", async (req) => {
    const commit = req.body?.commit;
    if (commit !== undefined && typeof commit !== "boolean") throw new HttpError(400, 'Body must be {"commit"?: boolean}');
    return engine.integrateWorkspace(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, req.params.runId, { commit: commit === true });
  });

  app.delete<{ Params: { key: string; runId: string }; Querystring: { force?: string } }>("/api/tasks/:key/workspaces/:runId", async (req) =>
    engine.removeWorkspace(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, req.params.runId, { force: req.query.force === "1" }),
  );

  // Not under run/: `run/complete` already marks one step done; this marks the whole task.
  app.put<{ Params: { key: string }; Body: { done?: unknown } | null }>("/api/tasks/:key/done", async (req) => {
    if (typeof req.body?.done !== "boolean") throw new HttpError(400, 'Body must be {"done": boolean}');
    return engine.setDone(requireRepo(), (await getTask(requireRepo(), req.params.key)).key, req.body.done);
  });
}
