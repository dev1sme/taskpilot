import { call } from "../../../shared/api/http";
import type { Preview, SaveResult } from "../shared/types";
import type { MigrationPreview, WorkflowConfig, WorkflowRawFile } from "./types";

const q = encodeURIComponent;

export const workflowConfigApi = {
  get: (mode?: string) => call<WorkflowConfig>("GET", `/api/config/workflow${mode ? `?mode=${q(mode)}` : ""}`),
  setMode: (mode: string) => call<{ selected: string }>("PUT", "/api/config/workflow/mode", { mode }),
  file: (name: string) => call<WorkflowRawFile>("GET", `/api/config/workflow/file?name=${q(name)}`),
  createOverride: (mode: string) => call<{ files: string[] }>("POST", "/api/config/workflow/override", { mode }),
  migrate: (body: { apply?: boolean; hashes?: Record<string, string> }) => call<MigrationPreview>("POST", "/api/config/workflow/override/migrate", body),
  reset: (hashes: Record<string, string>) => call<{ files: string[] }>("POST", "/api/config/workflow/reset", { hashes }),
  validate: (name: string, content: string) => call<{ errors: string[]; warnings: string[] }>("POST", "/api/config/workflow/validate", { name, content }),
  preview: (name: string, content: string, baseHash: string) => call<Preview & { warnings: string[] }>("POST", "/api/config/workflow/preview", { name, content, baseHash }),
  save: (name: string, content: string, baseHash: string) => call<SaveResult>("PUT", "/api/config/workflow/file", { name, content, baseHash }),
  remove: (name: string, baseHash: string) => call<SaveResult>("DELETE", `/api/config/workflow/file?name=${q(name)}&baseHash=${q(baseHash)}`),
  defaultDiff: (name: string) => call<{ diff: string; same: boolean }>("GET", `/api/config/workflow/default-diff?name=${q(name)}`),
  render: (body: { stepId: string; kind: "prompt" | "onReject" | "subtask"; feedback: string; restart: boolean; drafts: Record<string, string>; mode?: string }) =>
    call<{ task: { key: string; title: string }; text: string }>("POST", "/api/config/workflow/render", body),
};
