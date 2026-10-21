import type { Agent } from "../../shared/agents";

export interface UsageWindow {
  usedPercentage: number;
  /** Epoch ms. */
  resetsAt: number | null;
}

/** Account quota of another agent (Copilot); mirrors server/src/modules/usage/store.ts. */
export interface AgentQuota {
  /** Null when the entitlement is unlimited. */
  usedPercentage: number | null;
  unlimited: boolean;
  unit: "ai_credits" | "premium_requests";
  used: number | null;
  entitlement: number | null;
  /** Epoch ms. */
  resetsAt: number | null;
  updatedAt: number;
}

/**
 * Claude's plan usage (absent until a Claude session's status line reports it) and the other agents'
 * account quotas; mirrors server/src/modules/usage/store.ts.
 */
export interface UsageView {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  spend?: { usedPercentage: number };
  /** When Claude's numbers were reported. */
  updatedAt?: number;
  agents?: Partial<Record<Exclude<Agent, "claude">, AgentQuota>>;
}
