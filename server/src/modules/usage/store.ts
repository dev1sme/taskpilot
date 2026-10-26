import { EventEmitter } from "node:events";
import type { Agent } from "../../core/agents.js";
import type { CodexUsage, CodexUsageFields } from "../../core/codex/usage.js";
import type { CopilotQuota } from "../../core/copilot/quota.js";
import type { StateStore } from "../../core/state.js";

export interface UsageWindow {
  /** 0-100. */
  usedPercentage: number;
  /** Epoch ms; null when not given. */
  resetsAt: number | null;
}

/** Plan usage as Claude Code last reported it to a session's status line. */
export interface ClaudeUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  /** Spend against a Claude apps gateway cap. */
  spend?: { usedPercentage: number };
  updatedAt: number;
}

/** Claude's plan usage (top-level fields, absent until a Claude session reports it) and other agents' quotas. */
export interface UsageView extends Partial<ClaudeUsage> {
  agents?: { copilot?: CopilotQuota; codex?: CodexUsage };
}

/** Account observation, never the cause of a particular session/turn failure. */
export interface AccountQuotaEvidence {
  scope: "account";
  agent: Agent;
  source: "claude-statusline" | "copilot-quota";
  observedAt: number;
  validUntil: number;
  freshness: "fresh" | "stale";
  exhausted: boolean;
}

const EVIDENCE_MAX_AGE_MS = 5 * 60_000;

/** A status line fires after every message; persist and publish unchanged numbers at most this often. */
const REFRESH_MS = 60_000;

/**
 * Keeps the latest `rate_limits` from status line input (claude.ai Pro/Max, or a gateway with
 * spend limits). The numbers are account-wide. Stored in state so they survive a restart.
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

  async evidence(agent: Agent, now = Date.now()): Promise<AccountQuotaEvidence | null> {
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

  /** Input without rate limits (API key sign-in, before the first response) keeps the last numbers. */
  async apply(payload: Record<string, unknown>): Promise<void> {
    const next = parseRateLimits(payload.rate_limits);
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

function parseRateLimits(raw: unknown): Omit<ClaudeUsage, "updatedAt"> | null {
  if (!isObject(raw)) return null;
  const usage: Omit<ClaudeUsage, "updatedAt"> = {};
  const fiveHour = parseWindow(raw.five_hour);
  const sevenDay = parseWindow(raw.seven_day);
  if (fiveHour) usage.fiveHour = fiveHour;
  if (sevenDay) usage.sevenDay = sevenDay;
  if (isObject(raw.spend_limit) && isPercentage(raw.spend_limit.used_percentage)) {
    usage.spend = { usedPercentage: raw.spend_limit.used_percentage };
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!isObject(raw) || !isPercentage(raw.used_percentage)) return null;
  const resetsAt = typeof raw.resets_at === "number" && Number.isFinite(raw.resets_at) ? raw.resets_at * 1000 : null;
  return { usedPercentage: raw.used_percentage, resetsAt };
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

function isPercentage(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
