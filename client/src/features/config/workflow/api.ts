import { call } from "../../../shared/api/http";
import type { Preview, SaveResult } from "../shared/types";
import type { WorkflowConfig, WorkflowRawFile } from "./types";

const q = encodeURIComponent;

export const workflowConfigApi = {
  get: () => call<WorkflowConfig>("GET", "/api/config/workflow"),
  file: (name: string) => call<WorkflowRawFile>("GET", `/api/config/workflow/file?name=${q(name)}`),
  createOverride: () => call<{ files: string[] }>("POST", "/api/config/workflow/override"),
  reset: (hashes: Record<string, string>) => call<{ files: string[] }>("POST", "/api/config/workflow/reset", { hashes }),
  validate: (name: string, content: string) => call<{ errors: string[]; warnings: string[] }>("POST", "/api/config/workflow/validate", { name, content }),
  preview: (name: string, content: string, baseHash: string) =>
    call<Preview & { warnings: string[] }>("POST", "/api/config/workflow/preview", { name, content, baseHash }),
  save: (name: string, content: string, baseHash: string) => call<SaveResult>("PUT", "/api/config/workflow/file", { name, content, baseHash }),
  remove: (name: string, baseHash: string) => call<SaveResult>("DELETE", `/api/config/workflow/file?name=${q(name)}&baseHash=${q(baseHash)}`),
  defaultDiff: (name: string) => call<{ diff: string; same: boolean }>("GET", `/api/config/workflow/default-diff?name=${q(name)}`),
  render: (body: { taskKey: string; stepId: string; kind: "prompt" | "onReject"; drafts: Record<string, string> }) =>
    call<{ text: string }>("POST", "/api/config/workflow/render", body),
};
