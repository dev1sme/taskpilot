import { EventEmitter } from "node:events";
import type { ProviderId } from "@taskpilot/shared";
import type { CodexUsageFields } from "../../providers/codex/account-usage.js";
import type { CopilotQuota } from "../../providers/copilot/quota.js";
import type { ClaudeStatusLineUsage } from "../../providers/claude/status-line.js";
import type { StateStore } from "../../core/state.js";

import type { UsageWindow } from "../../core/usage-types.js";
import type { ClaudeUsage, UsageView, AccountQuotaEvidence } from "./types.js";
export type { UsageWindow } from "../../core/usage-types.js";

const EVIDENCE_MAX_AGE_MS = 5 * 60_000;

/** A status line fires after every message; persist and publish unchanged numbers at most this often. */
const REFRESH_MS = 60_000;

/**
 * Keeps the latest account usage of each agent: Claude's from its status line and `/usage`, the
 * others' from their pollers. The numbers are account-wide. Stored in state so they survive a restart.
 */
export class UsageStore extends EventEmitter<{ change: [usage: UsageView] }> {
  constructor(private readonly state: StateStore) {
    super();
  }

  async view(): Promise<UsageView | null> {
    const state = await this.state.load();
    const agents = state.agentUsage && Object.keys(state.agentUsage).length > 0 ? state.agentUsage : undefined;
    if (!state.usage && !agents) return null;
    return { ...state.usage, ...(agents ? { agents } : {}) };
  }

  async evidence(agent: ProviderId, now = Date.now()): Promise<AccountQuotaEvidence | null> {
    const state = await this.state.load();
    const usage = agent === "claude" ? state.usage : agent === "copilot" ? state.agentUsage?.copilot : undefined;
    if (!usage) return null;
    const windows = agent === "claude" ? [state.usage?.fiveHour, state.usage?.sevenDay, state.usage?.spend] : [state.agentUsage?.copilot];
    const active = windows.filter((window) => window && (!("resetsAt" in window) || window.resetsAt === null || window.resetsAt > now));
    const recent = Number.isFinite(usage.updatedAt) && now >= usage.updatedAt && now - usage.updatedAt <= EVIDENCE_MAX_AGE_MS;
    return {
      scope: "account",
      agent,
      source: agent === "claude" ? "claude-statusline" : "copilot-quota",
      observedAt: usage.updatedAt,
      validUntil: Math.min(usage.updatedAt + EVIDENCE_MAX_AGE_MS, ...active.map((window) => (window && "resetsAt" in window && window.resetsAt !== null ? window.resetsAt : Infinity))),
      freshness: recent && active.length > 0 ? "fresh" : "stale",
      exhausted: active.some((window) => window?.usedPercentage === 100 && (!("unlimited" in window) || !window.unlimited)),
    };
  }

  /** A status line's plan usage replaces the stored numbers; null (no rate limits in it) keeps the last ones. */
  async applyStatusLine(next: ClaudeStatusLineUsage | null): Promise<void> {
    if (!next) return;
    const prev = (await this.state.load()).usage;
    const now = Date.now();
    if (prev && sameNumbers(prev, next) && now - prev.updatedAt < REFRESH_MS) return;
    const usage = { ...next, updatedAt: now };
    await this.state.update((s) => {
      s.usage = usage;
    });
    await this.publish();
  }

  /** Merges windows read by `/usage` into the stored numbers; absent windows and `spend` (status line only) keep their value. */
  async applyClaude(fields: { fiveHour?: UsageWindow; sevenDay?: UsageWindow } | null): Promise<void> {
    if (!fields || (!fields.fiveHour && !fields.sevenDay)) return;
    const prev = (await this.state.load()).usage;
    const now = Date.now();
    const { updatedAt: _prevAt, ...prevFields } = prev ?? { updatedAt: 0 };
    const merged: Omit<ClaudeUsage, "updatedAt"> = { ...prevFields };
    if (fields.fiveHour) merged.fiveHour = fields.fiveHour;
    if (fields.sevenDay) merged.sevenDay = fields.sevenDay;
    if (prev && sameNumbers(prev, merged) && now - prev.updatedAt < REFRESH_MS) return;
    await this.state.update((s) => {
      s.usage = { ...merged, updatedAt: now };
    });
    await this.publish();
  }

  /** Latest quota of an agent; null removes it (agent not installed or logged out). */
  async applyAgent(agent: "copilot", quota: Omit<CopilotQuota, "updatedAt"> | null): Promise<void> {
    const prev = (await this.state.load()).agentUsage?.[agent];
    const now = Date.now();
    if (!quota && !prev) return;
    if (quota && prev && sameQuota(prev, quota) && now - prev.updatedAt < REFRESH_MS) return;
    await this.state.update((s) => {
      const agents = { ...s.agentUsage };
      if (quota) agents[agent] = { ...quota, updatedAt: now };
      else delete agents[agent];
      s.agentUsage = agents;
    });
    await this.publish();
  }

  /** Merges a (possibly sparse) Codex rate-limit update into the stored numbers; absent fields keep their last value. */
  async applyCodex(update: CodexUsageFields | null): Promise<void> {
    if (!update) return;
    const prev = (await this.state.load()).agentUsage?.codex;
    const now = Date.now();
    const { updatedAt: _prevAt, ...prevFields } = prev ?? { updatedAt: 0 };
    const merged: CodexUsageFields = { ...prevFields, ...update };
    if (prev && sameCodex(prevFields, merged) && now - prev.updatedAt < REFRESH_MS) return;
    await this.state.update((s) => {
      s.agentUsage = { ...s.agentUsage, codex: { ...merged, updatedAt: now } };
    });
    await this.publish();
  }

  private async publish(): Promise<void> {
    const view = await this.view();
    if (view) this.emit("change", view);
  }
}

function sameNumbers(a: Omit<ClaudeUsage, "updatedAt">, b: Omit<ClaudeUsage, "updatedAt">): boolean {
  const key = (u: Omit<ClaudeUsage, "updatedAt">) => JSON.stringify([u.fiveHour, u.sevenDay, u.spend]);
  return key(a) === key(b);
}

function sameQuota(a: Omit<CopilotQuota, "updatedAt">, b: Omit<CopilotQuota, "updatedAt">): boolean {
  const key = (q: Omit<CopilotQuota, "updatedAt">) => JSON.stringify([q.usedPercentage, q.unlimited, q.unit, q.used, q.entitlement, q.resetsAt]);
  return key(a) === key(b);
}

function sameCodex(a: CodexUsageFields, b: CodexUsageFields): boolean {
  const key = (u: CodexUsageFields) => JSON.stringify([u.fiveHour, u.sevenDay, u.credits, u.planType, u.rateLimitReachedType]);
  return key(a) === key(b);
}
