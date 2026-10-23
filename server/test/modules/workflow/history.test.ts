import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendHandoffHistory, formatEntry, HISTORY_TEXT, summarizeMetrics } from "../../../src/modules/workflow/history.js";
import { createSafeText } from "../../../src/core/safe-text.js";
import type { ExecutionAttempt, HandoffJournal, RunState } from "../../../src/modules/workflow/types.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

describe("history entry", () => {
  it("appends a sanitized handoff once per operation and stage while preserving previous history", async () => {
    const dir = await tempDir("handoff-history-");
    const file = path.join(dir, "00-history.md");
    await writeFile(file, "# Existing\n\nKeep this entry.\n");
    const sanitize = createSafeText(["opaque-private-value"]);
    const operation: HandoffJournal = {
      operationId: "op-1",
      scope: { kind: "step", stepId: "work" },
      stage: "failed",
      sourceSessionId: "source",
      targetSessionId: "target",
      expectedGeneration: 1,
      target: { agent: "codex" },
      previewId: "preview",
      fingerprint: "revision",
      text: "Context opaque-private-value",
      error: "Authorization: Bearer ghp_123456789012345678901234567890123456",
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work opaque-private-value", operation, sanitize);
    const first = await readFile(file, "utf8");
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work", operation, sanitize);
    expect(await readFile(file, "utf8")).toBe(first);
    expect(first.startsWith("# Existing\n\nKeep this entry.\n")).toBe(true);
    expect(first).toContain("taskpilot-handoff:op-1:failed");
    expect(first).toContain("[REDACTED]");
    expect(first).not.toContain("opaque-private-value");
    expect(first).not.toContain("ghp_123456789012345678901234567890123456");
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work", { ...operation, stage: "committed", error: undefined }, sanitize);
    const final = await readFile(file, "utf8");
    expect(final).toContain("taskpilot-handoff:op-1:committed");
    expect(final.startsWith(first)).toBe(true);
    const recovered: HandoffJournal = { ...operation, stage: "committed", recovery: "blocked", cleanup: "blocked", error: "ownership opaque-private-value" };
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work", recovered, sanitize);
    const blocked = await readFile(file, "utf8");
    expect(blocked).toContain(":recovery-blocked");
    expect(blocked).not.toContain("opaque-private-value");
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work", recovered, sanitize);
    expect(await readFile(file, "utf8")).toBe(blocked);
    await appendHandoffHistory(dir, "00-history.md", "DEMO-1", "Work", { ...recovered, recovery: "interrupted", cleanup: "complete" }, sanitize);
    expect(await readFile(file, "utf8")).toContain(":recovery-interrupted");
  });
  it("formats a heading, a quote and a body", () => {
    const at = new Date(2026, 9, 20, 14, 3).getTime();
    expect(formatEntry({ at, step: "Implement", source: "Ba góp ý", quote: "a\nb", body: "c" })).toBe("## 2026-10-20 14:03 · Implement · Ba góp ý\n\n> a\n> b\n\nc\n");
  });

  it("names the subagent and model of a subtask when the table gives them", () => {
    expect(
      HISTORY_TEXT.dispatchBody(
        [
          { n: 1, agent: "Claude", subagent: "taskpilot-implementer", model: "haiku", title: "A", deps: [] },
          { n: 2, agent: "Copilot", model: "gpt-5", title: "B", deps: [1] },
          { n: 3, agent: "Claude", title: "C", deps: [] },
        ],
        1,
      ),
    ).toBe("1. Claude · taskpilot-implementer · haiku — A\n2. Copilot · gpt-5 — B (sau việc 1)\n3. Claude — C");
    expect(HISTORY_TEXT.subtaskDone(1, "Claude", "taskpilot-implementer", "haiku")).toBe("Việc 1 xong · Claude · taskpilot-implementer · haiku");
    expect(HISTORY_TEXT.subtaskDone(2, "Copilot")).toBe("Việc 2 xong · Copilot");
  });

  it("writes a subtask's numbers under its report, saying what is unknown", () => {
    expect(HISTORY_TEXT.subtaskDoneBody("03-viec-1.md", { model: "claude-haiku-4-5", costUsd: 1.006, durationMs: 3_930_000 })).toBe(
      "Báo cáo: 03-viec-1.md\nSố liệu: model `claude-haiku-4-5` · 1 giờ 5 phút · $1.01",
    );
    expect(HISTORY_TEXT.metrics({ durationMs: 120_000 })).toBe("model không rõ · 2 phút · chi phí không có");
    expect(HISTORY_TEXT.subtaskDoneBody("03-viec-2.md")).toBe("Báo cáo: 03-viec-2.md");
  });
});

describe("session usage summaries", () => {
  const scope = { kind: "subtask" as const, stepId: "work", n: 1 };
  const attempt = (id: string, sessionId: string, generation = 1): ExecutionAttempt => ({
    id,
    sessionId,
    generation,
    scope,
    execution: { agent: "codex", source: "execution", modelSource: "default" },
    startedAt: generation * 1000,
  });

  it("counts cumulative thread snapshots once across steps and retries without mutating legacy attempts", () => {
    const first = { ...attempt("one", "thread-session"), metrics: { inputTokens: 100, outputTokens: 10 }, metricsSource: "codex-thread" as const };
    const retried = { ...attempt("two", "thread-session", 2), metrics: { inputTokens: 150, outputTokens: 15 }, metricsSource: "codex-thread" as const };
    const laterStep = {
      ...attempt("three", "thread-session", 2),
      scope: { kind: "step" as const, stepId: "review" },
      metrics: { inputTokens: 180, outputTokens: 18 },
      metricsSource: "codex-thread" as const,
    };
    const another = { ...attempt("four", "other-thread"), metrics: { inputTokens: 20, outputTokens: 2 }, metricsSource: "codex-thread" as const };
    const run = { attempts: [first, retried, laterStep, another] };
    const before = structuredClone(run);
    const summary = summarizeMetrics(run);
    expect(summary.sessions).toHaveLength(2);
    expect(summary.totals).toEqual({ inputTokens: 200, outputTokens: 20 });
    expect(summary.coverage).toEqual({ inputTokens: 2, outputTokens: 2, costUsd: 0 });
    expect(run).toEqual(before);
  });

  it("does not turn partial provider measurements into a complete total or borrow legacy cost", () => {
    const run: Pick<RunState, "attempts" | "sessionMetrics"> = {
      attempts: [attempt("source", "claude"), attempt("target", "codex")],
      sessionMetrics: [
        { sessionId: "claude", source: "claude-statusline", basis: "session", metrics: { costUsd: 0.5 } },
        { sessionId: "codex", source: "legacy", basis: "unknown", metrics: { costUsd: 99, model: "unverified" } },
        { sessionId: "codex", source: "codex-thread", basis: "thread", metrics: { inputTokens: 100, outputTokens: 0 } },
      ],
    };
    const summary = summarizeMetrics(run);
    expect(summary.totals).toEqual({});
    expect(summary.coverage).toEqual({ inputTokens: 1, outputTokens: 1, costUsd: 1 });
    expect(summary.sessions[1].metrics).toEqual({ inputTokens: 100, outputTokens: 0 });
    expect(summary.sessions[1].actualModels).toEqual([]);
    expect(summary.sessions[1].measurements).toHaveLength(2);
  });

  it("reads untagged legacy metrics without claiming their model is backend evidence", () => {
    const run = { subtasks: [{ n: 1, agent: "claude" as const, sessionId: "legacy-session", metrics: { costUsd: 1, model: "requested-or-actual", inputTokens: 7 } }] };
    const summary = summarizeMetrics(run, scope);
    expect(summary.sessions[0]).toMatchObject({ sessionId: "legacy-session", actualModels: [], measurements: [{ source: "legacy", basis: "unknown" }] });
    expect(summary.totals).toEqual({ costUsd: 1, inputTokens: 7 });
    expect(HISTORY_TEXT.usage(summary)).toContain("dữ liệu legacy");
    expect(HISTORY_TEXT.usage(summary)).not.toContain("requested-or-actual");
  });

  it("keeps missing and invalid measurements absent while preserving measured zero", () => {
    const summary = summarizeMetrics({
      sessionMetrics: [
        { sessionId: "s", source: "codex-thread", basis: "thread", metrics: { inputTokens: Number.NaN, outputTokens: -1, costUsd: Number.POSITIVE_INFINITY } },
        { sessionId: "s", source: "codex-thread", basis: "thread", metrics: { inputTokens: 0 } },
      ],
    });
    expect(summary.totals).toEqual({ inputTokens: 0 });
    expect(summary.coverage).toEqual({ inputTokens: 1, outputTokens: 0, costUsd: 0 });
  });

  it("labels requested/default models and backend sources separately in completion history", () => {
    const a = {
      ...attempt("a", "source"),
      execution: { agent: "claude" as const, model: "haiku", source: "assignment" as const, modelSource: "explicit" as const },
      actualModel: "claude-measured",
    };
    const b = attempt("b", "target");
    const summary = summarizeMetrics({
      attempts: [a, b],
      sessionMetrics: [{ sessionId: "source", source: "claude-statusline", basis: "session", observedAt: 100, metrics: { costUsd: 0.42 } }],
    });
    const body = HISTORY_TEXT.subtaskDoneBody("report.md", undefined, summary, [a, b]);
    expect(body).toContain("model yêu cầu `haiku` · model thực tế `claude-measured`");
    expect(body).toContain("model yêu cầu mặc định · model thực tế không rõ");
    expect(body).toContain("Nguồn `claude-statusline`");
    expect(body).toContain("chi phí không có");
    expect(body).not.toContain("$0.00");
  });
});
