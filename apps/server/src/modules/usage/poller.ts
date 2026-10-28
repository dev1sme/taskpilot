/** An agent's account numbers are read at most this often. */
const MIN_INTERVAL_MS = 60_000;
/** Period of the background reads, which need no session. */
const BACKGROUND_MS = 5 * 60_000;
/** A read still running past its minute is retried this much later. */
const BUSY_RETRY_MS = 1000;

export interface QuotaPollerOptions<T> {
  /** Reads the agent's numbers. Rejects on failure. */
  fetch: () => Promise<T>;
  /** Writes what `fetch` returned. */
  apply: (result: T) => Promise<void>;
  onError?: (e: unknown) => void;
  minIntervalMs?: number;
  backgroundMs?: number;
}

/**
 * Keeps one agent's account usage fresh: `start()` reads right away and then every five minutes;
 * `request()` reads on demand, right away when the last read is a minute old, otherwise once at
 * the end of that minute so the last activity is never missed. Reads never overlap; a failure is
 * reported through `onError` and the last numbers are kept.
 */
export class QuotaPoller<T = unknown> {
  private lastStart = 0;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly minIntervalMs: number;
  private readonly backgroundMs: number;

  constructor(private readonly opts: QuotaPollerOptions<T>) {
    this.minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
    this.backgroundMs = opts.backgroundMs ?? BACKGROUND_MS;
  }

  start(): void {
    if (this.interval || this.stopped) return;
    this.request();
    this.interval = setInterval(() => this.request(), this.backgroundMs);
    this.interval.unref();
  }

  request(): void {
    if (this.timer || this.stopped) return;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait <= 0 && !this.running) {
      this.run();
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.request();
      },
      Math.max(wait, BUSY_RETRY_MS),
    );
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  /** Resolves when the read in progress, if any, is done (tests). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private run(): void {
    this.lastStart = Date.now();
    this.running = this.refresh()
      .catch(this.opts.onError ?? (() => {}))
      .finally(() => {
        this.running = null;
      });
  }

  private async refresh(): Promise<void> {
    const result = await this.opts.fetch();
    if (!this.stopped) await this.opts.apply(result);
  }
}
