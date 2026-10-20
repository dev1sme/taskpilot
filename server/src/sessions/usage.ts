import { EventEmitter } from "node:events";
import type { StateStore } from "../core/state.js";

export interface UsageWindow {
  /** 0-100. */
  usedPercentage: number;
  /** Epoch ms; null when not given. */
  resetsAt: number | null;
}

/** Plan usage as Claude Code last reported it to a session's status line. */
export interface UsageView {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  /** Spend against a Claude apps gateway cap. */
  spend?: { usedPercentage: number };
  updatedAt: number;
}

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
    return (await this.state.load()).usage ?? null;
  }

  /** Input without rate limits (API key sign-in, before the first response) keeps the last numbers. */
  async apply(payload: Record<string, unknown>): Promise<void> {
    const next = parseRateLimits(payload.rate_limits);
    if (!next) return;
    const prev = await this.view();
    const now = Date.now();
    if (prev && sameNumbers(prev, next) && now - prev.updatedAt < REFRESH_MS) return;
    const usage = { ...next, updatedAt: now };
    await this.state.update((s) => {
      s.usage = usage;
    });
    this.emit("change", usage);
  }
}

function parseRateLimits(raw: unknown): Omit<UsageView, "updatedAt"> | null {
  if (!isObject(raw)) return null;
  const usage: Omit<UsageView, "updatedAt"> = {};
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

function sameNumbers(a: Omit<UsageView, "updatedAt">, b: Omit<UsageView, "updatedAt">): boolean {
  const key = (u: Omit<UsageView, "updatedAt">) => JSON.stringify([u.fiveHour, u.sevenDay, u.spend]);
  return key(a) === key(b);
}

function isPercentage(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
