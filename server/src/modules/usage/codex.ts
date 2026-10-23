import os from "node:os";
import { CodexError } from "../../core/codex/errors.js";
import { codexLoggedIn, initializeCodex, spawnCodex } from "../../core/codex/rpc.js";
import { codexRateLimits, type CodexUsageFields } from "../../core/codex/usage.js";
import type { UsageStore } from "./store.js";

/** Codex's account limits are read by starting an app-server: at most this often. */
const MIN_INTERVAL_MS = 60_000;
/** Period of the reads that need no session. */
const POLL_MS = 5 * 60_000;
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

/**
 * Keeps Codex's usage fresh without a Codex session: one read at start, then every five minutes.
 * `request()` reads on demand, at most once a minute. Reads never overlap; failures are reported
 * and the last numbers are kept.
 */
export class CodexQuotaPoller {
  private lastStart = 0;
  private running: Promise<void> | null = null;
  private interval: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly usage: UsageStore,
    private readonly fetch: () => Promise<CodexUsageFields | null> = fetchCodexUsage,
    private readonly onError: (e: unknown) => void = () => {},
  ) {}

  start(): void {
    if (this.interval || this.stopped) return;
    this.request();
    this.interval = setInterval(() => this.request(), POLL_MS);
    this.interval.unref();
  }

  request(): void {
    if (this.stopped || this.running || Date.now() - this.lastStart < MIN_INTERVAL_MS) return;
    this.lastStart = Date.now();
    this.running = this.refresh()
      .catch(this.onError)
      .finally(() => {
        this.running = null;
      });
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  /** Resolves when the read in progress, if any, is done (tests). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async refresh(): Promise<void> {
    const fields = await this.fetch();
    if (fields && !this.stopped) await this.usage.applyCodex(fields);
  }
}
