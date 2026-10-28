import type { ClaudeStatusLineUsage } from "../../providers/claude/status-line.js";
import type { CodexUsage } from "../../providers/codex/account-usage.js";
import type { CopilotQuota } from "../../providers/copilot/quota.js";
import type { ProviderId } from "@taskpilot/shared";

/** Plan usage as Claude Code last reported it to a session's status line. */
export interface ClaudeUsage extends ClaudeStatusLineUsage {
  updatedAt: number;
}

/** Claude's plan usage (top-level fields, absent until a Claude session reports it) and other agents' quotas. */
export interface UsageView extends Partial<ClaudeUsage> {
  agents?: { copilot?: CopilotQuota; codex?: CodexUsage };
}

/** Account observation, never the cause of a particular session/turn failure. */
export interface AccountQuotaEvidence {
  scope: "account";
  agent: ProviderId;
  source: "claude-statusline" | "copilot-quota";
  observedAt: number;
  validUntil: number;
  freshness: "fresh" | "stale";
  exhausted: boolean;
}
