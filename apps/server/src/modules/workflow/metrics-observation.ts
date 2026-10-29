import type { SessionMetrics } from "../sessions/index.js";
import type { SessionMetricSnapshot, SubtaskMetrics } from "./types.js";

/** Apply only ordered evidence. Reading a file again does not create a newer measurement. */
export function updateCodexMeasurement(snapshot: SessionMetricSnapshot, incoming: SubtaskMetrics, observation: SessionMetrics): boolean {
  const checkedAt = observation.availability?.checkedAt ?? Date.now();
  const hasPrevious = snapshot.metrics.inputTokens !== undefined || snapshot.metrics.outputTokens !== undefined;
  const unavailable = (state: "missing" | "unsupported" | "unverified", reason = observation.availability?.reason) => {
    snapshot.availability = { state: hasPrevious ? "stale" : state, reason, checkedAt };
    return false;
  };
  if (observation.availability?.state !== "available") {
    const state = observation.availability?.state;
    return unavailable(state === "unsupported" || state === "unverified" ? state : "missing");
  }
  const sample = observation.sample;
  if (!sample || !snapshot.nativeId || sample.nativeId !== snapshot.nativeId) return unavailable("unverified", "identity-mismatch");
  const previous = snapshot.sample;
  if (previous) {
    if (sample.nativeId !== previous.nativeId) return unavailable("unverified", "identity-mismatch");
    if (sample.fileId === previous.fileId) {
      if (sample.offset < previous.offset) return false;
      if (sample.offset === previous.offset) {
        if (incoming.inputTokens !== snapshot.metrics.inputTokens || incoming.outputTokens !== snapshot.metrics.outputTokens) return unavailable("unverified", "source-changed");
        // A re-read can recover a missing source, but must keep the original sample time.
        snapshot.availability = { state: "available", checkedAt };
        return false;
      }
    } else if (sample.at === undefined || previous.at === undefined) return unavailable("unverified", "source-changed");
    else if (sample.at <= previous.at) return false;
    // A newer but smaller total may indicate compaction/reset; do not guess a new basis or use max.
    if (
      ["inputTokens", "outputTokens"].some((key) => {
        const k = key as "inputTokens" | "outputTokens";
        return incoming[k] !== undefined && snapshot.metrics[k] !== undefined && incoming[k]! < snapshot.metrics[k]!;
      })
    )
      return unavailable("unverified", "source-changed");
  }
  snapshot.metrics = { ...(snapshot.metrics.model ? { model: snapshot.metrics.model } : {}), ...incoming };
  snapshot.sample = sample;
  snapshot.observedAt = sample.at ?? checkedAt;
  snapshot.availability = { state: "available", checkedAt };
  return true;
}
