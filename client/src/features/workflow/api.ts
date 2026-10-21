import { call, taskUrl } from "../../shared/api/http";
import type { ModesInfo, RunState, RunView } from "./types";

export const workflowApi = {
  modes: () => call<ModesInfo>("GET", "/api/config/workflow/modes"),
  run: (key: string) => call<RunView>("GET", `${taskUrl(key)}/run`),
  startRun: (key: string, mode?: string) => call<RunState>("POST", `${taskUrl(key)}/run`, mode ? { mode } : undefined),
  cancelRun: (key: string) => call<RunState>("DELETE", `${taskUrl(key)}/run`),
  approve: (key: string, note = "") => call<RunState>("POST", `${taskUrl(key)}/run/approve`, { note }),
  reply: (key: string, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/reply`, { text }),
  feedback: (key: string, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/feedback`, { text }),
  retry: (key: string) => call<RunState>("POST", `${taskUrl(key)}/run/retry`),
  replySubtask: (key: string, n: number, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/subtasks/${n}/reply`, { text }),
  retrySubtask: (key: string, n: number) => call<RunState>("POST", `${taskUrl(key)}/run/subtasks/${n}/retry`),
  restartRun: (key: string, mode?: string) => call<RunState>("POST", `${taskUrl(key)}/run/restart`, mode ? { mode } : undefined),
};
