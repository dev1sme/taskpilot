import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import type { MetricSample, ObservationAvailability, ObservationReason } from "../../core/observation-types.js";

const ROLLOUT_TAIL_BYTES = 1 << 20;
// session_meta can embed base/developer instructions and AGENTS.md; a short head would reject every hook before bind.
const ROLLOUT_HEAD_BYTES = 1 << 20;

export interface RolloutTokens {
  inputTokens?: number;
  outputTokens?: number;
  availability: ObservationAvailability;
  sample?: MetricSample;
}

interface RolloutIdentity {
  id?: unknown;
  source?: unknown;
  cwd?: unknown;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const unavailable = (reason: ObservationReason): RolloutTokens => ({ availability: { state: reason === "identity-mismatch" ? "unverified" : "missing", reason, checkedAt: Date.now() } });

async function identityOf(handle: FileHandle): Promise<RolloutIdentity | null> {
  const buffer = Buffer.alloc(ROLLOUT_HEAD_BYTES);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const text = buffer.subarray(0, bytesRead).toString("utf8");
  const end = text.indexOf("\n");
  if (end < 0) return null;
  try {
    const record: unknown = JSON.parse(text.slice(0, end));
    return object(record) && record.type === "session_meta" && object(record.payload) ? record.payload : null;
  } catch {
    return null;
  }
}

/** Only inspect the supplied rollout; never search personal history for a replacement. */
export async function rolloutIdentity(file: string): Promise<RolloutIdentity | null> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) return null;
      return await identityOf(handle);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Root-thread cumulative counters, with ordering evidence and explicit absence, from a bounded tail. */
export async function rolloutTokens(file: string, expectedNativeId: string): Promise<RolloutTokens> {
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return unavailable("file-unreadable");
      const identity = await identityOf(handle);
      if (!identity || identity.id !== expectedNativeId || identity.source !== "cli") return unavailable("identity-mismatch");
      const length = Math.min(stat.size, ROLLOUT_TAIL_BYTES);
      const start = stat.size - length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
      let offset = start;
      if (start > 0) offset += Buffer.byteLength(lines.shift() ?? "") + 1;
      let latest: RolloutTokens | undefined;
      let invalid = false;
      // Ignore an incomplete final line while the CLI writes it.
      for (const line of lines.slice(0, -1)) {
        offset += Buffer.byteLength(line) + 1;
        if (!line.includes('"token_count"')) continue;
        try {
          const record: unknown = JSON.parse(line);
          if (!object(record) || record.type !== "event_msg" || !object(record.payload) || record.payload.type !== "token_count") continue;
          const info = record.payload.info;
          const total = object(info) ? info.total_token_usage : undefined;
          if (!object(total)) continue;
          const inputTokens = counter(total.input_tokens) ? total.input_tokens : undefined;
          const outputTokens = counter(total.output_tokens) ? total.output_tokens : undefined;
          if (inputTokens === undefined && outputTokens === undefined) {
            invalid = true;
            continue;
          }
          const at = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
          latest = {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            availability: { state: "available", checkedAt: Date.now() },
            sample: { nativeId: expectedNativeId, fileId: `${stat.dev}:${stat.ino}`, offset, ...(Number.isFinite(at) ? { at } : {}) },
          };
        } catch {
          invalid = true;
        }
      }
      return latest ?? unavailable(invalid ? "invalid-rollout" : "no-sample");
    } finally {
      await handle.close();
    }
  } catch (error) {
    return unavailable((error as NodeJS.ErrnoException).code === "ENOENT" ? "file-missing" : "file-unreadable");
  }
}
