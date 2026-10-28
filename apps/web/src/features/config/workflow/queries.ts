import type { ExecutionSelection, MigrationPreview, RenderedPrompt, WorkflowChecks, WorkflowConfigView, WorkflowFileView, WorkflowSavePreview } from "@taskpilot/server/api-types";
import { useQuery } from "@tanstack/react-query";
import { call, query } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useRepo } from "@/features/workspace/queries";

export const WORKFLOW_FILE = "workflow.yml";

export const workflowConfigApi = {
  get: (mode?: string) => call<WorkflowConfigView>("GET", `/api/config/workflow${query({ mode })}`),
  file: (name: string) => call<WorkflowFileView>("GET", `/api/config/workflow/file${query({ name })}`),
  setMode: (mode: string, baseHash: string) => call<{ hash: string }>("PUT", "/api/config/workflow/mode", { mode, baseHash }),
  createOverride: (mode: string) => call<{ files: string[] }>("POST", "/api/config/workflow/override", { mode }),
  migrate: (body: { apply?: boolean; hashes?: Record<string, string> }) => call<MigrationPreview>("POST", "/api/config/workflow/override/migrate", body),
  reset: (hashes: Record<string, string>) => call<{ files: string[] }>("POST", "/api/config/workflow/reset", { hashes }),
  validate: (name: string, content: string) => call<WorkflowChecks>("POST", "/api/config/workflow/validate", { name, content }),
  preview: (name: string, content: string, baseHash: string) => call<WorkflowSavePreview>("POST", "/api/config/workflow/preview", { name, content, baseHash }),
  save: (name: string, content: string, baseHash: string) => call<{ hash: string }>("PUT", "/api/config/workflow/file", { name, content, baseHash }),
  remove: (name: string, baseHash: string) => call<{ hash: string }>("DELETE", `/api/config/workflow/file${query({ name, baseHash })}`),
  defaultDiff: (name: string) => call<{ diff: string; same: boolean }>("GET", `/api/config/workflow/default-diff${query({ name })}`),
  render: (body: {
    stepId: string;
    kind: "prompt" | "onReject" | "subtask";
    feedback: string;
    restart: boolean;
    drafts: Record<string, string>;
    mode?: string;
    execution?: ExecutionSelection;
  }) => call<RenderedPrompt>("POST", "/api/config/workflow/render", body),
};

export function useWorkflowConfig(mode: string | undefined) {
  const repo = useRepo().data?.path;
  return useQuery({ queryKey: ["workflow", repo, mode ?? ""], queryFn: () => workflowConfigApi.get(mode), enabled: Boolean(repo) });
}

/** Task stages and runs read the workflow, so everything that depends on it refreshes. */
export async function refreshWorkflow(): Promise<void> {
  await Promise.all(["workflow", "workflow-modes", "execution-defaults", "run-preview", "run", "tasks"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}
