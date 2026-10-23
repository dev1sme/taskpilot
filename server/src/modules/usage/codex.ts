import os from "node:os";
import { CodexError } from "../../core/codex/errors.js";
import { codexLoggedIn, initializeCodex, spawnCodex } from "../../core/codex/rpc.js";
import { codexRateLimits, type CodexUsageFields } from "../../core/codex/usage.js";
import { QuotaPoller } from "./poller.js";
import type { UsageStore } from "./store.js";

const TIMEOUT_MS = 15_000;

/**
 * Account rate limits of the logged-in Codex user, read from a short-lived `codex app-server`
 * (no thread or turn is created). Null when Codex is missing, signed out or has no numbers.
 * Rejects on other failures.
 */
export async function fetchCodexUsage(timeoutMs = TIMEOUT_MS): Promise<CodexUsageFields | null> {
  let proc: Awaited<ReturnType<typeof spawnCodex>>;
  try {
    proc = await spawnCodex({}, os.tmpdir());
  } catch (error) {
    if (error instanceof CodexError && error.code === "missing") return null;
    throw error;
  }
  const timer = setTimeout(() => {
    proc.rpc.close();
    proc.child.kill("SIGKILL");
  }, timeoutMs);
  try {
    await initializeCodex(proc.rpc, { timeoutMs });
    if (!(await codexLoggedIn(proc.rpc))) return null;
    return await codexRateLimits(proc.rpc);
  } finally {
    clearTimeout(timer);
    proc.rpc.close();
    proc.child.kill("SIGKILL");
  }
}

/** Codex's poller: its numbers also come from its sessions, this fills them in before any exists. */
export function createCodexPoller(usage: UsageStore, fetch: () => Promise<CodexUsageFields | null> = fetchCodexUsage, onError?: (e: unknown) => void): QuotaPoller<CodexUsageFields | null> {
  return new QuotaPoller({
    fetch,
    apply: async (fields) => {
      if (fields) await usage.applyCodex(fields);
    },
    onError,
  });
}
