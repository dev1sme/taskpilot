import type {
  ExecutionSelection,
  HandoffCommitRequest,
  HandoffJournal,
  HandoffPreviewResult,
  HandoffRequest,
  RunPreview,
  RunState,
  RunView,
  WorkspaceDiff,
  WorkspaceView,
  WorktreeCheck,
} from "@taskpilot/server/api-types";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/api";
import { useInvalidateOn } from "@/lib/events";
import { queryClient } from "@/lib/query-client";
import { taskUrl, useRepo } from "@/features/workspace/queries";

/** What a run starts with: a workflow mode and an execution choice; both optional (repo defaults). */
export interface RunOptions {
  mode?: string;
  execution?: ExecutionSelection;
  /** "worktree": the run gets its own Git worktree; absent = it runs in the repo. */
  isolation?: "repo" | "worktree";
  /** The user saw the repo's uncommitted files and starts from HEAD without them. */
  acceptDirtyBase?: boolean;
}

const run = (key: string) => `${taskUrl(key)}/run`;

export const workflowApi = {
  view: (key: string) => call<RunView>("GET", run(key)),
  preview: (key: string, options: RunOptions) => call<RunPreview>("POST", `${run(key)}/preview`, options),
  start: (key: string, options?: RunOptions) => call<RunState>("POST", run(key), options),
  restart: (key: string, options?: RunOptions) => call<RunState>("POST", `${run(key)}/restart`, options),
  cancel: (key: string) => call<RunState>("DELETE", run(key)),
  approve: (key: string, note = "") => call<RunState>("POST", `${run(key)}/approve`, { note }),
  feedback: (key: string, text: string) => call<RunState>("POST", `${run(key)}/feedback`, { text }),
  reply: (key: string, text: string) => call<RunState>("POST", `${run(key)}/reply`, { text }),
  retry: (key: string) => call<RunState>("POST", `${run(key)}/retry`),
  completeStep: (key: string) => call<RunState>("POST", `${run(key)}/complete`),
  replySubtask: (key: string, n: number, text: string) => call<RunState>("POST", `${run(key)}/subtasks/${n}/reply`, { text }),
  retrySubtask: (key: string, n: number) => call<RunState>("POST", `${run(key)}/subtasks/${n}/retry`),
  completeSubtask: (key: string, n: number) => call<RunState>("POST", `${run(key)}/subtasks/${n}/complete`),
  previewHandoff: (key: string, request: HandoffRequest) => call<HandoffPreviewResult>("POST", `${run(key)}/handoff/preview`, request),
  commitHandoff: (key: string, request: HandoffCommitRequest) => call<{ operation: HandoffJournal }>("POST", `${run(key)}/handoff`, request),
  worktreeCheck: (key: string) => call<WorktreeCheck>("GET", `${run(key)}/worktree-check`),
};

const workspacesUrl = (key: string) => `${taskUrl(key)}/workspaces`;

export const workspaceApi = {
  list: (key: string) => call<WorkspaceView[]>("GET", workspacesUrl(key)),
  diff: (key: string, runId: string) => call<WorkspaceDiff>("GET", `${workspacesUrl(key)}/${encodeURIComponent(runId)}/diff`),
  integrate: (key: string, runId: string, commit = false) => call<WorkspaceView>("POST", `${workspacesUrl(key)}/${encodeURIComponent(runId)}/integrate`, { commit }),
  remove: (key: string, runId: string, force = false) => call<WorkspaceView>("DELETE", `${workspacesUrl(key)}/${encodeURIComponent(runId)}${force ? "?force=1" : ""}`),
};

/** The task's run worktrees, refreshed with the run. */
export function useWorkspaces(taskKey: string) {
  const repo = useRepo().data?.path;
  const key = ["workspaces", taskKey, repo];
  useInvalidateOn("run", key, taskKey);
  return useQuery({ queryKey: key, queryFn: () => workspaceApi.list(taskKey), enabled: Boolean(repo) });
}

export const runKey = (taskKey: string, repo: string | null | undefined) => ["run", taskKey, repo];

/** The task's workflow and latest run, kept live through "run" events. */
export function useRun(taskKey: string) {
  const repo = useRepo().data?.path;
  const key = runKey(taskKey, repo);
  useInvalidateOn("run", key, taskKey);
  return useQuery({ queryKey: key, queryFn: () => workflowApi.view(taskKey), enabled: Boolean(repo) });
}

/** After an action: the run, its sessions and the task list show what changed. */
export async function refreshTask(taskKey: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["run", taskKey] }),
    queryClient.invalidateQueries({ queryKey: ["workspaces", taskKey] }),
    queryClient.invalidateQueries({ queryKey: ["sessions", taskKey] }),
    queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  ]);
}
