import { call, taskUrl } from "../../shared/api/http";
import type { RunState, RunView } from "./types";

export const workflowApi = {
  run: (key: string) => call<RunView>("GET", `${taskUrl(key)}/run`),
  startRun: (key: string) => call<RunState>("POST", `${taskUrl(key)}/run`),
  cancelRun: (key: string) => call<RunState>("DELETE", `${taskUrl(key)}/run`),
  approve: (key: string, note = "") => call<RunState>("POST", `${taskUrl(key)}/run/approve`, { note }),
  reply: (key: string, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/reply`, { text }),
  feedback: (key: string, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/feedback`, { text }),
  retry: (key: string) => call<RunState>("POST", `${taskUrl(key)}/run/retry`),
  replySubtask: (key: string, n: number, text: string) => call<RunState>("POST", `${taskUrl(key)}/run/subtasks/${n}/reply`, { text }),
  retrySubtask: (key: string, n: number) => call<RunState>("POST", `${taskUrl(key)}/run/subtasks/${n}/retry`),
  restartRun: (key: string) => call<RunState>("POST", `${taskUrl(key)}/run/restart`),
};
