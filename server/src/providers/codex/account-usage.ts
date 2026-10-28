import type { UsageWindow } from "../../core/usage-types.js";
import type { CodexRpc } from "./app-server.js";
import { isObject } from "../../core/values.js";

export interface CodexCredits {
  hasCredits: boolean;
  unlimited: boolean;
  /** Decimal string as Codex reports it; null when not given. */
  balance: string | null;
}

/** Account rate limits of Codex (`account/rateLimits/*`): numbers of the whole account, not of a session. */
export interface CodexUsage {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  credits?: CodexCredits;
  planType?: string;
  /** Set by Codex when a limit was hit; null once cleared. Display only, never quota evidence. */
  rateLimitReachedType?: string | null;
  updatedAt: number;
}

export type CodexUsageFields = Omit<CodexUsage, "updatedAt">;

const FIVE_HOUR_MINS = 300;
const SEVEN_DAY_MINS = 10080;
/** Codex's own limit id; snapshots of other limits (per-model) must not overwrite it. */
const CODEX_LIMIT_ID = "codex";

/**
 * Reads `account/rateLimits/read` over an open, initialized connection. Null when the answer
 * carries no usable number. Rejects when the request fails (not signed in, old Codex).
 */
export async function fetchCodexRateLimits(rpc: CodexRpc): Promise<CodexUsageFields | null> {
  return parseCodexRateLimits(await rpc.request("account/rateLimits/read"));
}

/**
 * Parses a `RateLimitSnapshot`, a `{rateLimits}` notification body, or a
 * `GetAccountRateLimitsResponse` (preferring `rateLimitsByLimitId.codex`). Each field is guarded
 * on its own and left out when missing or invalid, so callers merge sparse updates.
 */
export function parseCodexRateLimits(raw: unknown): CodexUsageFields | null {
  const snapshot = pickSnapshot(raw);
  if (!snapshot) return null;
  const usage: CodexUsageFields = {};
  for (const key of ["primary", "secondary"] as const) {
    const parsed = parseWindow(snapshot[key]);
    if (!parsed) continue;
    if (parsed.minutes === FIVE_HOUR_MINS) usage.fiveHour = parsed.window;
    else if (parsed.minutes === SEVEN_DAY_MINS) usage.sevenDay = parsed.window;
  }
  const credits = parseCredits(snapshot.credits);
  if (credits) usage.credits = credits;
  if (typeof snapshot.planType === "string" && snapshot.planType) usage.planType = snapshot.planType;
  if (typeof snapshot.rateLimitReachedType === "string" || snapshot.rateLimitReachedType === null) {
    usage.rateLimitReachedType = snapshot.rateLimitReachedType;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function pickSnapshot(raw: unknown): Record<string, unknown> | null {
  if (!isObject(raw)) return null;
  const byId = isObject(raw.rateLimitsByLimitId) ? raw.rateLimitsByLimitId[CODEX_LIMIT_ID] : undefined;
  const candidate = isObject(byId) ? byId : isObject(raw.rateLimits) ? raw.rateLimits : raw;
  if (!isObject(candidate)) return null;
  const limitId = candidate.limitId;
  if (typeof limitId === "string" && limitId !== CODEX_LIMIT_ID) return null;
  return candidate;
}

function parseWindow(raw: unknown): { minutes: number; window: UsageWindow } | null {
  if (!isObject(raw)) return null;
  const { usedPercent, windowDurationMins, resetsAt } = raw;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  if (typeof windowDurationMins !== "number") return null;
  return {
    minutes: windowDurationMins,
    window: { usedPercentage: usedPercent, resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt * 1000 : null },
  };
}

function parseCredits(raw: unknown): CodexCredits | null {
  if (!isObject(raw) || typeof raw.hasCredits !== "boolean" || typeof raw.unlimited !== "boolean") return null;
  return { hasCredits: raw.hasCredits, unlimited: raw.unlimited, balance: typeof raw.balance === "string" ? raw.balance : null };
}
