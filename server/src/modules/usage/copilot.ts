import { copilotQuota, type CopilotQuotaResult } from "../../core/copilot/quota.js";
import type { AgentQuota, UsageStore } from "./store.js";

/** Copilot's quota is read by starting a runtime: at most this often. */
const INTERVAL_MS = 60_000;

/**
 * `premium_interactions` of `account.getQuota`: the account's main budget, in AI credits with
 * usage-based billing (`tokenBasedBilling`) and in premium requests on the legacy plans. The map's
 * keys and fields come from the runtime unchecked, so each one is guarded. Null when unusable.
 */
export function parseCopilotQuota(snapshots: unknown): Omit<AgentQuota, "updatedAt"> | null {
  if (!isObject(snapshots) || !isObject(snapshots.premium_interactions)) return null;
  const raw = snapshots.premium_interactions;
  const entitlement = finite(raw.entitlementRequests);
  const unlimited = raw.isUnlimitedEntitlement === true || (entitlement !== null && entitlement < 0);
  const remaining = finite(raw.remainingPercentage);
  if (!unlimited && (remaining === null || remaining < 0 || remaining > 100)) return null;
  // An unlimited account reports the time of the call as its reset date (copilot 1.0.101).
  const resetsAt = unlimited || typeof raw.resetDate !== "string" ? null : Date.parse(raw.resetDate);
  return {
    usedPercentage: unlimited ? null : 100 - remaining!,
    unlimited,
    unit: raw.tokenBasedBilling === true ? "ai_credits" : "premium_requests",
    used: finite(raw.usedRequests),
    entitlement: unlimited || entitlement === null || entitlement <= 0 ? null : entitlement,
    resetsAt: resetsAt !== null && Number.isFinite(resetsAt) ? resetsAt : null,
  };
}

/**
 * Refreshes Copilot's quota when a Copilot session ends a turn: right away when the last read is a
 * minute old, otherwise once at the end of that minute, so the last turn is never missed. Reads
 * never overlap. A missing or logged-out Copilot removes the quota; other failures keep it.
 */
export class CopilotQuotaPoller {
  private lastStart = 0;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly usage: UsageStore,
    private readonly fetch: () => Promise<CopilotQuotaResult> = copilotQuota,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}

  request(): void {
    if (this.timer) return;
    const wait = this.lastStart + INTERVAL_MS - Date.now();
    if (wait <= 0 && !this.running) {
      this.run();
      return;
    }
    // A read still running past its minute (up to the 15 s timeout) is retried a second later.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.request();
    }, Math.max(wait, 1000));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Resolves when the read in progress, if any, is done (tests). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private run(): void {
    this.lastStart = Date.now();
    this.running = this.refresh()
      .catch(this.onError)
      .finally(() => {
        this.running = null;
      });
  }

  private async refresh(): Promise<void> {
    const result = await this.fetch();
    if (result.ok) {
      const quota = parseCopilotQuota(result.snapshots);
      if (quota) await this.usage.applyAgent("copilot", quota);
    } else if (result.reason !== "failed") {
      await this.usage.applyAgent("copilot", null);
    }
  }
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
