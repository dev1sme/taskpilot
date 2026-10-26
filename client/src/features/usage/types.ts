export interface UsageWindow {
  usedPercentage: number;
  /** Epoch ms. */
  resetsAt: number | null;
}

/** Account quota of Copilot; mirrors server/src/core/copilot/quota.ts. */
export interface CopilotQuota {
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

export interface CodexCredits {
  hasCredits: boolean;
  unlimited: boolean;
  /** Decimal string as Codex reports it; null when not given. */
  balance: string | null;
}

/** Account rate limits of Codex; mirrors server/src/core/codex/usage.ts. Every field but updatedAt may be missing. */
export interface CodexUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  credits?: CodexCredits;
  planType?: string;
  rateLimitReachedType?: string | null;
  /** Epoch ms. */
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
  agents?: { copilot?: CopilotQuota; codex?: CodexUsage };
}
