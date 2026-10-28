import { open } from "node:fs/promises";
import path from "node:path";
import { copilotHome } from "../../../../providers/copilot/home.js";

/** Enough of events.jsonl to find the last assistant message of a turn. */
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
/**
 * Copilot fires Stop before events.jsonl has the turn's last lines (copilot 1.0.101): wait this long
 * at most for an `assistant.turn_end` from around the Stop.
 */
const TRANSCRIPT_WAIT_MS = 3000;
const TRANSCRIPT_POLL_MS = 100;
/** A turn_end this close before the Stop belongs to the turn that stopped. */
const TURN_END_SLACK_MS = 500;

/** events.jsonl of a Copilot session. */
export function copilotTranscript(sessionId: string): string {
  return path.join(copilotHome(), "session-state", sessionId, "events.jsonl");
}

export async function readTail(file: string): Promise<string | null> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * The last non-empty `assistant.message` of a Copilot events.jsonl; null when unreadable. With
 * `stoppedAt` (the Stop hook's time), waits until the file has that turn's end.
 */
export async function lastAssistantMessage(file: string, stoppedAt?: number): Promise<string | null> {
  const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
  for (;;) {
    const found = await readLastMessage(file);
    const complete = stoppedAt === undefined || (found?.turnEndedAt ?? 0) >= stoppedAt - TURN_END_SLACK_MS;
    if (!found || complete || Date.now() >= deadline) return found?.message ?? null;
    await new Promise((r) => setTimeout(r, TRANSCRIPT_POLL_MS));
  }
}

async function readLastMessage(file: string): Promise<{ message: string | null; turnEndedAt: number } | null> {
  const text = await readTail(file);
  if (text === null) return null;
  const lines = text.split("\n");
  let turnEndedAt = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant.')) continue;
    let event: { type?: unknown; timestamp?: unknown; data?: { content?: unknown } };
    try {
      event = JSON.parse(lines[i]) as typeof event;
    } catch {
      // The first line of the tail may be cut in half.
      continue;
    }
    if (event.type === "assistant.turn_end" && !turnEndedAt && typeof event.timestamp === "string") {
      turnEndedAt = Date.parse(event.timestamp) || 0;
    } else if (event.type === "assistant.message" && typeof event.data?.content === "string" && event.data.content.trim()) {
      return { message: event.data.content, turnEndedAt };
    }
  }
  return { message: null, turnEndedAt };
}
