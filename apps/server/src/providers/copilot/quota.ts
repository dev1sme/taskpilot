import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { childEnv } from "../../core/launch.js";
import { isObject } from "../../core/values.js";

/** Account quota of Copilot (`premium_interactions` of `account.getQuota`). */
export interface CopilotQuota {
  /** 0-100; null when the entitlement is unlimited. */
  usedPercentage: number | null;
  unlimited: boolean;
  /** Unit of `used` and `entitlement`: AI credits (usage-based billing) or premium requests (legacy). */
  unit: "ai_credits" | "premium_requests";
  used: number | null;
  /** Null when unlimited or not given. */
  entitlement: number | null;
  /** Epoch ms; null when not given. */
  resetsAt: number | null;
  updatedAt: number;
}

export type CopilotQuotaResult =
  | { ok: true; snapshots: unknown }
  /** missing: no copilot binary; unauthenticated: not logged in; failed: anything else. */
  | { ok: false; reason: "missing" | "unauthenticated" | "failed" };

const TIMEOUT_MS = 15_000;
/** After SIGTERM, wait this long before SIGKILL. */
const KILL_GRACE_MS = 2000;

/**
 * Account quota of the logged-in Copilot user: one `account.getQuota` JSON-RPC request to a
 * headless runtime (`copilot --headless --stdio`, the command @github/copilot-sdk spawns), then the
 * runtime is stopped. Returns the raw `quotaSnapshots`; nothing here is type-checked. Checked on
 * copilot 1.0.101 (protocol 3): check it again after every Copilot upgrade (docs/SPEC.md §7).
 */
export async function copilotQuota(opts: { file?: string; timeoutMs?: number } = {}): Promise<CopilotQuotaResult> {
  // The runtime writes one log file per start, even with --log-level none: keep it out of ~/.copilot.
  const logDir = await mkdtemp(path.join(os.tmpdir(), "taskpilot-copilot-"));
  try {
    return await request(opts.file ?? process.env.TASKPILOT_COPILOT ?? "copilot", logDir, opts.timeoutMs ?? TIMEOUT_MS);
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
}

/**
 * `premium_interactions` of `account.getQuota`: the account's main budget, in AI credits with
 * usage-based billing (`tokenBasedBilling`) and in premium requests on the legacy plans. The map's
 * keys and fields come from the runtime unchecked, so each one is guarded. Null when unusable.
 */
export function parseCopilotQuota(snapshots: unknown): Omit<CopilotQuota, "updatedAt"> | null {
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

function request(file: string, logDir: string, timeoutMs: number): Promise<CopilotQuotaResult> {
  return new Promise((resolve) => {
    const child = spawn(file, ["--headless", "--no-auto-update", "--log-level", "none", "--log-dir", logDir, "--stdio"], {
      cwd: logDir,
      env: childEnv(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    const finish = (result: CopilotQuotaResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      // Resolve once the runtime is gone, so the log directory can be removed.
      void exited.then(() => {
        clearTimeout(kill);
        resolve(result);
      });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "failed" }), timeoutMs);

    child.once("error", (err: NodeJS.ErrnoException) => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: err.code === "ENOENT" ? "missing" : "failed" });
    });
    child.once("exit", () => finish({ ok: false, reason: "failed" }));
    child.stdin.on("error", () => finish({ ok: false, reason: "failed" }));

    readMessages(child.stdout, (msg) => {
      if (msg.id !== 1) return;
      if (msg.error !== undefined) {
        const message = isObject(msg.error) && typeof msg.error.message === "string" ? msg.error.message : "";
        finish({ ok: false, reason: /not authenticated/i.test(message) ? "unauthenticated" : "failed" });
      } else if (isObject(msg.result)) {
        finish({ ok: true, snapshots: msg.result.quotaSnapshots });
      } else {
        finish({ ok: false, reason: "failed" });
      }
    });

    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "account.getQuota", params: {} });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
}

/** JSON-RPC messages framed with `Content-Length` headers (vscode-jsonrpc), as the runtime sends them. */
function readMessages(stream: NodeJS.ReadableStream, onMessage: (msg: Record<string, unknown>) => void): void {
  let buf = Buffer.alloc(0);
  stream.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, end).toString())?.[1]);
      if (!Number.isFinite(length)) {
        // Not a frame header: drop it and look for the next one.
        buf = buf.subarray(end + 4);
        continue;
      }
      if (buf.length < end + 4 + length) return;
      const text = buf.subarray(end + 4, end + 4 + length).toString();
      buf = buf.subarray(end + 4 + length);
      try {
        const msg: unknown = JSON.parse(text);
        if (isObject(msg)) onMessage(msg);
      } catch {
        // A broken frame is skipped; the timeout covers a reply that never comes.
      }
    }
  });
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
