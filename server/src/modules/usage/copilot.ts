import { copilotQuota, type CopilotQuotaResult } from "../../core/copilot/quota.js";
import { QuotaPoller } from "./poller.js";
import type { AgentQuota, UsageStore } from "./store.js";

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
 * Copilot's poller: a Copilot session asks (ready, tool done, turn ended) through `request()`.
 * A missing or logged-out Copilot removes the quota; other failures keep it.
 */
export function createCopilotPoller(usage: UsageStore, fetch: () => Promise<CopilotQuotaResult> = copilotQuota, onError?: (e: unknown) => void): QuotaPoller<CopilotQuotaResult> {
  return new QuotaPoller({
    fetch,
    apply: async (result) => {
      if (result.ok) {
        const quota = parseCopilotQuota(result.snapshots);
        if (quota) await usage.applyAgent("copilot", quota);
      } else if (result.reason !== "failed") {
        await usage.applyAgent("copilot", null);
      }
    },
    onError,
  });
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
