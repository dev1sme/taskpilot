import { describe, expect, it } from "vitest";
import { updateCodexMeasurement } from "../../../src/modules/workflow/metrics-observation.js";
import { measuredMetrics, mergeCumulative, summarizeMetrics } from "../../../src/modules/workflow/history.js";
import type { SessionMetricSnapshot } from "../../../src/modules/workflow/types.js";
const snapshot = (): SessionMetricSnapshot => ({ sessionId: "s", nativeId: "root", source: "codex-thread", basis: "thread", metrics: {} });
const observed = (offset = 10, fileId = "file", nativeId = "root") => ({
  source: "codex-thread" as const,
  availability: { state: "available" as const, checkedAt: 100 },
  sample: { nativeId, fileId, offset },
});

describe("Codex cumulative snapshot", () => {
  it("does not add duplicate samples, replace newer samples with late data, or change measurement time", () => {
    const s = snapshot();
    expect(updateCodexMeasurement(s, { inputTokens: 10, outputTokens: 3 }, observed(10))).toBe(true);
    const at = s.observedAt;
    expect(updateCodexMeasurement(s, { inputTokens: 10, outputTokens: 3 }, observed(10))).toBe(false);
    expect(updateCodexMeasurement(s, { inputTokens: 20, outputTokens: 6 }, observed(20))).toBe(true);
    expect(updateCodexMeasurement(s, { inputTokens: 10, outputTokens: 3 }, observed(10))).toBe(false);
    expect(s.metrics.inputTokens).toBe(20);
    expect(s.observedAt).toBe(at);
  });
  it("preserves last-known numbers as stale on failure, and restores availability on re-read", () => {
    const s = snapshot();
    updateCodexMeasurement(s, { inputTokens: 0 }, observed());
    updateCodexMeasurement(s, {}, { availability: { state: "missing", reason: "file-missing", checkedAt: 200 } });
    expect(s).toMatchObject({ metrics: { inputTokens: 0 }, availability: { state: "stale", reason: "file-missing" }, observedAt: 100 });
    updateCodexMeasurement(s, { inputTokens: 0 }, observed());
    expect(s.availability?.state).toBe("available");
    expect(s.observedAt).toBe(100);
  });
  it("keeps missing data missing and rejects changed identity/source or counter reset", () => {
    const s = snapshot();
    updateCodexMeasurement(s, {}, { availability: { state: "missing", reason: "no-sample" } });
    expect(s.metrics).toEqual({});
    updateCodexMeasurement(s, { inputTokens: 12 }, observed());
    updateCodexMeasurement(s, { inputTokens: 99 }, observed(20, "file", "child"));
    expect(s.metrics.inputTokens).toBe(12);
    expect(s.availability?.reason).toBe("identity-mismatch");
    updateCodexMeasurement(s, { inputTokens: 99 }, observed(20, "rotated"));
    expect(s.availability?.reason).toBe("source-changed");
    updateCodexMeasurement(s, { inputTokens: 1 }, observed(20));
    expect(s.metrics.inputTokens).toBe(12);
    expect(s.availability?.state).toBe("stale");
  });
  it("does not fill a missing counter from an older sample", () => {
    const s = snapshot();
    updateCodexMeasurement(s, { inputTokens: 12, outputTokens: 3 }, observed());
    updateCodexMeasurement(s, { inputTokens: 14 }, observed(20));
    expect(s.metrics).toEqual({ inputTokens: 14 });
  });
  it("dedupes a native thread shared by sessions and preserves partial coverage", () => {
    const one = { ...snapshot(), agent: "codex" as const, metrics: { inputTokens: 12 }, observedAt: 1 };
    const two = { ...one, sessionId: "other", metrics: { inputTokens: 15 }, observedAt: 2 };
    const result = summarizeMetrics({ sessionMetrics: [one, two] });
    expect(result.totals.inputTokens).toBe(15);
    expect(result.totals.outputTokens).toBeUndefined();
    expect(result.coverage.inputTokens).toBe(2);
    expect(result.sessions).toHaveLength(2);
    expect(summarizeMetrics({ sessionMetrics: [one, { ...two, nativeId: "different", metrics: {} }] }).totals.inputTokens).toBeUndefined();
  });
  it("retains legacy and other-provider zero, cost and cumulative behavior", () => {
    expect(measuredMetrics({ inputTokens: NaN, outputTokens: -1, costUsd: 0 })).toEqual({ costUsd: 0 });
    expect(mergeCumulative({ inputTokens: 10, costUsd: 0.2 }, { inputTokens: 12 })).toEqual({ inputTokens: 12, costUsd: 0.2 });
    expect(summarizeMetrics({ sessionMetrics: [{ ...snapshot(), nativeId: undefined, source: "claude-statusline", metrics: { costUsd: 0.2, inputTokens: 10 } }] }).totals).toEqual({
      costUsd: 0.2,
      inputTokens: 10,
    });
  });
});
it("does not accept overwritten data at the same source position as a fresh duplicate", () => {
  const s = snapshot();
  updateCodexMeasurement(s, { inputTokens: 10 }, observed());
  updateCodexMeasurement(s, { inputTokens: 99 }, observed());
  expect(s.metrics.inputTokens).toBe(10);
  expect(s.availability).toMatchObject({ state: "stale", reason: "source-changed" });
});
it("orders a rotated source by verified source time and keeps the latest duplicate snapshot", () => {
  const s = snapshot();
  updateCodexMeasurement(s, { inputTokens: 10 }, { ...observed(), sample: { ...observed().sample, at: 100 } });
  updateCodexMeasurement(s, { inputTokens: 11 }, { ...observed(1, "rotated"), sample: { ...observed(1, "rotated").sample, at: 101 } });
  expect(s.metrics.inputTokens).toBe(11);
  const older = { ...s, metrics: { inputTokens: 5 }, observedAt: 99 };
  expect(summarizeMetrics({ sessionMetrics: [s, older] }).totals.inputTokens).toBe(11);
});
it("keeps sparse legacy provider snapshots and withholds ambiguous same-thread totals", () => {
  const base = { ...snapshot(), source: "claude-statusline" as const, nativeId: undefined, metrics: { inputTokens: 10, costUsd: 0.3 } };
  expect(summarizeMetrics({ sessionMetrics: [base, { ...base, metrics: { inputTokens: 12 } }] }).totals).toEqual({ inputTokens: 12, costUsd: 0.3 });
  expect(
    summarizeMetrics({
      sessionMetrics: [
        { ...snapshot(), metrics: { inputTokens: 10 } },
        { ...snapshot(), sessionId: "other", metrics: { inputTokens: 20 } },
      ],
    }).totals.inputTokens,
  ).toBeUndefined();
});
