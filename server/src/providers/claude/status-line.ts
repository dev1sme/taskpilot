import type { UsageWindow } from "../../core/usage-types.js";

/** Account plan usage in a status line: claude.ai Pro/Max windows, or a gateway's spend cap. */
export interface ClaudeStatusLineUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  /** Spend against a Claude apps gateway cap. */
  spend?: { usedPercentage: number };
}

/** The model id and session cost in a Claude Code status line payload; fields it lacks are left out. */
export function claudeStatusLineMetrics(payload: Record<string, unknown>): { model?: string; costUsd?: number } {
  const model = payload.model as { id?: unknown } | undefined;
  const cost = payload.cost as { total_cost_usd?: unknown } | undefined;
  return {
    ...(typeof model?.id === "string" && model.id ? { model: model.id } : {}),
    ...(typeof cost?.total_cost_usd === "number" && Number.isFinite(cost.total_cost_usd) ? { costUsd: cost.total_cost_usd } : {}),
  };
}

/** The `rate_limits` of a status line payload; null without any valid window (API key sign-in, before the first response). */
export function claudeStatusLineUsage(payload: Record<string, unknown>): ClaudeStatusLineUsage | null {
  const raw = payload.rate_limits;
  if (!isObject(raw)) return null;
  const usage: ClaudeStatusLineUsage = {};
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

function isPercentage(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
