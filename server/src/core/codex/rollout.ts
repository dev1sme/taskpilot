import { open } from "node:fs/promises";

/** Largest tail of a Codex rollout file read to find its last `token_count`. */
const ROLLOUT_TAIL_BYTES = 1 << 20;

export interface RolloutTokens {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Cumulative thread tokens from the last `token_count` event of a Codex rollout (the `transcript_path`
 * of its hooks). Best effort: an unreadable file or one without a measurement yields nothing.
 */
export async function rolloutTokens(file: string): Promise<RolloutTokens> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, ROLLOUT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n");
      if (length < size) lines.shift(); // first line may be cut
      for (const line of lines.reverse()) {
        if (!line.includes('"token_count"')) continue;
        let record: { type?: string; payload?: { type?: string; info?: { total_token_usage?: { input_tokens?: unknown; output_tokens?: unknown } } } };
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        const total = record.type === "event_msg" && record.payload?.type === "token_count" ? record.payload.info?.total_token_usage : undefined;
        if (!total) continue;
        return {
          ...(typeof total.input_tokens === "number" ? { inputTokens: total.input_tokens } : {}),
          ...(typeof total.output_tokens === "number" ? { outputTokens: total.output_tokens } : {}),
        };
      }
    } finally {
      await handle.close();
    }
  } catch {
    // no rollout, no metrics
  }
  return {};
}
