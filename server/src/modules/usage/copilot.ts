import { copilotQuota, parseCopilotQuota, type CopilotQuotaResult } from "../../core/copilot/quota.js";
import { QuotaPoller } from "./poller.js";
import type { UsageStore } from "./store.js";

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
