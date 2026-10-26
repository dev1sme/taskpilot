import type { Agent } from "../../shared/agents";

/** Session key of the repo terminal (sessions without a task); mirrors server/src/modules/tasks/scan.ts. */
export const REPO_SESSION_KEY = "@repo";

export interface SessionView {
  id: string;
  taskKey: string;
  title: string;
  agent: Agent;
  createdAt: number;
  status: "running" | "exited";
  exitCode: number | null;
  activity: "starting" | "idle" | "busy" | "permission" | null;
  reservation?: { operationId: string; role: "source" | "target"; at: number };
  retired?: { operationId: string; replacedBy: string; at: number };
  failure?: {
    reason: "quota" | "auth" | "model" | "cli" | "network" | "unknown";
    message: string;
    observedAt: number;
    generation?: number;
    evidence: {
      source: "unclassified";
    };
  };
  accountQuota?: {
    scope: "account";
    agent: Agent;
    source: "claude-statusline" | "copilot-quota";
    observedAt: number;
    freshness: "fresh" | "stale";
    validUntil?: number;
    exhausted: boolean;
  };
}
