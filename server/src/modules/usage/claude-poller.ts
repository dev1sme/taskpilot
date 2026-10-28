import { fetchClaudeUsage, type ClaudeUsageFields } from "../../providers/claude/account-usage.js";
import { QuotaPoller } from "./poller.js";
import type { UsageStore } from "./store.js";

/** Claude's poller: the status line also pushes these numbers, this keeps them fresh between messages. */
export function createClaudePoller(
  usage: UsageStore,
  fetch: () => Promise<ClaudeUsageFields | null> = fetchClaudeUsage,
  onError?: (e: unknown) => void,
): QuotaPoller<ClaudeUsageFields | null> {
  return new QuotaPoller({
    fetch,
    apply: async (fields) => {
      if (fields) await usage.applyClaude(fields);
    },
    onError,
  });
}
