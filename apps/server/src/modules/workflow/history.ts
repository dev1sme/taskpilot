import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ExecutionAttempt, HandoffJournal, LaneScope, MetricsSummary, RunState, SessionUsage, SubtaskMetrics, SubtaskRun } from "./types.js";
import type { SafeText } from "../../core/safe-text.js";

const counters = ["inputTokens", "outputTokens", "costUsd"] as const;
const sameScope = (a: LaneScope, b: LaneScope) => a.kind === b.kind && a.stepId === b.stepId && (a.kind !== "subtask" || (b.kind === "subtask" && a.n === b.n));

/** Ignore invalid/missing numbers; a measured zero is different from an absent measurement. */
export function measuredMetrics(data: SubtaskMetrics): SubtaskMetrics {
  return {
    ...(typeof data.model === "string" && data.model ? { model: data.model } : {}),
    ...Object.fromEntries(counters.filter((key) => typeof data[key] === "number" && Number.isFinite(data[key]) && data[key]! >= 0).map((key) => [key, data[key]])),
  };
}

/** Cumulative notifications (including after resume) replace a snapshot, never add to it. */
export function mergeCumulative(before: SubtaskMetrics = {}, incoming: SubtaskMetrics): SubtaskMetrics {
  return { ...before, ...measuredMetrics(incoming) };
}

/** Read old state without mutating it. Reused sessions/threads count once across attempts and steps. */
export function summarizeMetrics(
  run: Pick<RunState, "attempts" | "sessionMetrics" | "handoffs"> & { sessionId?: string; subtasks?: Array<Pick<SubtaskRun, "n" | "agent" | "sessionId" | "metrics">> },
  scope?: LaneScope,
): MetricsSummary {
  const sessions = new Map<string, SessionUsage>();
  const attempts = (run.attempts ?? []).filter((a) => !scope || sameScope(a.scope, scope));
  const ensure = (id: string) => {
    if (!sessions.has(id)) sessions.set(id, { sessionId: id, attemptIds: [], scopes: [], actualModels: [], measurements: [], metrics: {} });
    return sessions.get(id)!;
  };
  for (const attempt of attempts) {
    const session = ensure(attempt.sessionId);
    session.agent = attempt.execution.agent;
    session.nativeId = attempt.nativeId ?? session.nativeId;
    session.attemptIds.push(attempt.id);
    if (!session.scopes.some((s) => sameScope(s, attempt.scope))) session.scopes.push(attempt.scope);
    if (attempt.actualModel && !session.actualModels.includes(attempt.actualModel)) session.actualModels.push(attempt.actualModel);
  }
  if (!scope && run.sessionId) ensure(run.sessionId);
  for (const handoff of run.handoffs ?? []) {
    if (handoff.stage !== "committed" || (scope && !sameScope(handoff.scope, scope))) continue;
    for (const id of [handoff.sourceSessionId, handoff.targetSessionId]) {
      if (!id) continue;
      const session = ensure(id);
      if (!session.scopes.some((s) => sameScope(s, handoff.scope))) session.scopes.push(handoff.scope);
    }
  }
  const snapshots = [...(run.sessionMetrics ?? [])];
  for (const attempt of attempts) {
    // Persisted per-session observations are authoritative. Old attempts may contain a requested
    // model or an elapsed lane duration, neither of which is backend evidence.
    if (!run.sessionMetrics?.some((m) => m.sessionId === attempt.sessionId) && attempt.metrics)
      snapshots.push({
        sessionId: attempt.sessionId,
        nativeId: attempt.nativeId,
        agent: attempt.execution.agent,
        generation: attempt.generation,
        source: attempt.metricsSource ?? "legacy",
        basis: attempt.metricsSource === "codex-thread" ? "thread" : attempt.metricsSource === "claude-statusline" ? "session" : "unknown",
        observedAt: attempt.metricsObservedAt,
        metrics: measuredMetrics(attempt.metrics),
      });
  }
  for (const sub of run.subtasks ?? []) {
    if (!sub.sessionId || (scope && (scope.kind !== "subtask" || scope.n !== sub.n))) continue;
    if (scope && !attempts.some((a) => a.sessionId === sub.sessionId) && run.attempts?.some((a) => a.sessionId === sub.sessionId)) continue;
    const session = ensure(sub.sessionId);
    session.agent ??= sub.agent;
    if (sub.metrics && !snapshots.some((m) => m.sessionId === sub.sessionId))
      snapshots.push({ sessionId: sub.sessionId, agent: sub.agent, source: "legacy", basis: "unknown", metrics: measuredMetrics(sub.metrics) });
  }
  for (const snapshot of snapshots) {
    if (scope && !sessions.has(snapshot.sessionId)) continue;
    const session = ensure(snapshot.sessionId);
    session.agent ??= snapshot.agent;
    session.nativeId ??= snapshot.nativeId;
    const previous = session.measurements.find((m) => m.source === snapshot.source);
    if (previous) {
      if (snapshot.source === "codex-thread" && (snapshot.availability || previous.availability)) {
        if ((snapshot.observedAt ?? 0) >= (previous.observedAt ?? 0)) Object.assign(previous, snapshot, { metrics: measuredMetrics(snapshot.metrics) });
      } else {
        // Preserve sparse legacy and other-provider observations exactly as before.
        previous.metrics = mergeCumulative(previous.metrics, snapshot.metrics);
        previous.observedAt = Math.max(previous.observedAt ?? 0, snapshot.observedAt ?? 0) || undefined;
      }
    } else session.measurements.push({ ...snapshot, metrics: measuredMetrics(snapshot.metrics) });
    if (snapshot.source !== "legacy" && snapshot.metrics.model && !session.actualModels.includes(snapshot.metrics.model)) session.actualModels.push(snapshot.metrics.model);
  }
  for (const session of sessions.values()) {
    // A legacy aggregate may already mix providers. Preserve it as legacy and do not fill gaps
    // in a new backend observation from it.
    const measured = session.measurements.filter((m) => m.source !== "legacy");
    for (const m of measured.length ? measured : session.measurements) {
      for (const key of counters) if (m.metrics[key] !== undefined) session.metrics[key] = m.metrics[key];
    }
  }
  const summary: MetricsSummary = { sessions: [...sessions.values()], totals: {}, coverage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  for (const key of counters) {
    const values = summary.sessions.flatMap((s) => (s.metrics[key] === undefined ? [] : [s.metrics[key]!]));
    summary.coverage[key] = values.length;
    if (values.length && values.length === summary.sessions.length) {
      // Two TaskPilot sessions may refer to the same resumed native thread. Its cumulative
      // total is one measurement, even though both sessions remain visible in the audit trail.
      const unique = new Map<string, { value: number; at: number; measurement?: SessionUsage["measurements"][number] }>();
      let ambiguous = false;
      for (const session of summary.sessions) {
        const native = session.measurements.find((m) => m.source === "codex-thread" && m.nativeId);
        const id = native ? `codex:${native.nativeId}` : `session:${session.sessionId}`;
        const at = native?.observedAt ?? 0;
        const previous = unique.get(id);
        const sameFile = native?.sample && previous?.measurement?.sample?.fileId === native.sample.fileId;
        const order = sameFile ? native!.sample!.offset - previous!.measurement!.sample!.offset : at - (previous?.at ?? 0);
        if (!previous || order > 0) unique.set(id, { value: session.metrics[key]!, at, measurement: native });
        else if (order === 0 && previous.value !== session.metrics[key]) ambiguous = true;
      }
      if (!ambiguous) summary.totals[key] = [...unique.values()].reduce((sum, m) => sum + m.value, 0);
    }
  }
  return summary;
}

/** Explicit provenance is shared by the review prompt and the append-only completion entry. */
function usage(summary: MetricsSummary, attempts: ExecutionAttempt[] = []): string {
  return summary.sessions
    .map((s) =>
      [
        `- Session \`${s.sessionId}\`${s.nativeId ? ` · native/thread \`${s.nativeId}\`` : ""} · ${s.agent ?? "agent không rõ"} · số đo cumulative của cả session/thread, không phân bổ cho từng bước.`,
        ...attempts
          .filter((a) => a.sessionId === s.sessionId)
          .map(
            (a) =>
              `  - Attempt \`${a.id}\` · generation ${a.generation} · model yêu cầu ${a.execution.model ? `\`${a.execution.model}\`` : "mặc định"} · model thực tế ${a.actualModel ? `\`${a.actualModel}\`` : "không rõ"} · bắt đầu ${a.startedAt}${a.finishedAt !== undefined ? ` · kết thúc ${a.finishedAt}` : ""}.`,
          ),
        ...(s.measurements.length
          ? s.measurements.map(
              (m) =>
                `  - Nguồn \`${m.source}\` · phạm vi ${m.basis}${m.observedAt !== undefined ? ` · ghi nhận ${m.observedAt}` : ""}${m.availability ? ` · trạng thái ${m.availability.state}${m.availability.reason ? ` (${m.availability.reason})` : ""}` : ""} · ${metrics(m.source === "legacy" ? { ...m.metrics, model: undefined } : m.metrics)}${m.source === "legacy" ? " · dữ liệu legacy, provenance/model thực tế chưa xác minh" : ""}.`,
            )
          : ["  - Số liệu không có; chi phí không có; model thực tế không rõ."]),
      ].join("\n"),
    )
    .join("\n");
}

export interface HistoryEntry {
  at: number;
  /** Title of the workflow step the entry belongs to. */
  step: string;
  /** Who or what the entry is about: "Ba góp ý", "Chạy lại từ đầu"… */
  source: string;
  /** Markdown under the heading. */
  body?: string;
  /** Text quoted verbatim, e.g. the reviewer's feedback. */
  quote?: string;
}

/** Who works on a subtask: "Claude · taskpilot-implementer · haiku", or just the agent for its defaults. */
function worker(agent: string, subagent?: string, model?: string): string {
  return [agent, subagent, model].filter(Boolean).join(" · ");
}

/** "1 giờ 5 phút", "12 phút 3 giây", "40 giây": precise enough to compare subtasks. */
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  if (h > 0) return `${h} giờ${m ? ` ${m} phút` : ""}`;
  if (m > 0) return `${m} phút${sec ? ` ${sec} giây` : ""}`;
  return `${sec} giây`;
}

/** A subtask's numbers on one line: "model `claude-haiku-4-5` · 12 phút 3 giây · $0.42"; what is unknown is said so. */
function metrics(m: SubtaskMetrics): string {
  return [
    m.model ? `model \`${m.model}\`` : "model không rõ",
    ...(m.durationMs !== undefined ? [duration(m.durationMs)] : []),
    m.costUsd !== undefined ? `$${m.costUsd.toFixed(2)}` : "chi phí không có",
    ...(m.inputTokens !== undefined ? [`${m.inputTokens} token vào`] : []),
    ...(m.outputTokens !== undefined ? [`${m.outputTokens} token ra`] : []),
  ].join(" · ");
}

/**
 * Wording of the entries TaskPilot writes. Not part of the UI resources: the log is a task document
 * that Claude reads back, so it stays in Vietnamese whatever the UI language.
 */
export const HISTORY_TEXT = {
  title: (taskKey: string) => `# ${taskKey} — Lịch sử quyết định`,
  start: "Bắt đầu quy trình",
  startBody: (mode: string, override: string | null, steps: number) => `Quy trình: ${mode}${override ? ` (+ override ${override})` : ""}, ${steps} bước.`,
  approve: "Ba duyệt",
  done: "Quy trình hoàn tất.",
  feedback: "Ba góp ý",
  reply: "Ba trả lời",
  cancel: "Huỷ quy trình",
  restart: "Chạy lại từ đầu",
  archived: (dir: string, files: string[]) => `Bản cũ: ${dir}/ (${files.join(", ")})`,
  nothingArchived: "Chưa có tài liệu nào để lưu bản cũ.",
  interrupted: "Gián đoạn",
  serverRestarted: "TaskPilot khởi động lại giữa bước.",
  sessionStopped: "Session dừng giữa bước.",
  switchAgent: "Đổi agent",
  switchModel: "Đổi model",
  handoff: "Bàn giao agent",
  handoffFailed: "Bàn giao gián đoạn",
  switchAgentBody: (from: string, to: string) => `Bước này chạy bằng ${to} trong session mới; session ${from} của bước trước đã dừng.`,
  dispatch: "Giao việc",
  worker,
  dispatchBody: (items: Array<{ n: number; agent: string; subagent?: string; model?: string; title: string; deps: number[] }>, parallel: number) =>
    [
      ...items.map((a) => `${a.n}. ${worker(a.agent, a.subagent, a.model)} — ${a.title}${a.deps.length ? ` (sau việc ${a.deps.join(", ")})` : ""}`),
      parallel > 1 ? `\nChạy tối đa ${parallel} việc cùng lúc.` : "",
    ]
      .join("\n")
      .trim(),
  subtaskDone: (n: number, agent: string, subagent?: string, model?: string) => `Việc ${n} xong · ${worker(agent, subagent, model)}`,
  metrics,
  usage,
  subtaskDoneBody: (report: string, m?: SubtaskMetrics, summary?: MetricsSummary, attempts?: ExecutionAttempt[]) =>
    `Báo cáo: ${report}${m ? `\n${summary && summary.sessions.length > 1 ? "Số liệu phiên hiện tại (thời gian cả việc)" : "Số liệu"}: ${metrics(m)}` : ""}${summary?.sessions.length ? `\n\nNguồn số liệu:\n${usage(summary, attempts)}` : ""}`,
  subtaskReply: (n: number) => `Ba trả lời việc ${n}`,
  subtaskInterrupted: (n: number) => `Việc ${n} gián đoạn`,
  subtaskSessionStopped: "Session của việc dừng giữa chừng.",
  markedDone: "Ba đánh dấu xong",
  markedDoneBody: (file: string) => `${file} đã ghi từ lúc gửi yêu cầu; TaskPilot không nhận được hook Stop của agent.`,
  subtaskMarkedDone: (n: number) => `Ba đánh dấu xong việc ${n}`,
  taskDone: "Ba đánh dấu task hoàn thành",
  taskReopened: "Ba mở lại task",
  transcriptStop: "Agent xong lượt (từ transcript)",
  transcriptStopBody: "Agent không gửi hook Stop; TaskPilot thấy lượt đã kết thúc trong transcript của session.",
  backToLeader: "Về leader rà soát",
  backToLeaderBody: (done: number) => `${done} việc đã xong; leader rà soát báo cáo của chúng.`,
} as const;

// "2026-10-20 14:03" in the server's time zone.
const TIME = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function formatEntry(entry: HistoryEntry): string {
  const parts = [`## ${TIME.format(entry.at)} · ${entry.step} · ${entry.source}`];
  if (entry.quote !== undefined)
    parts.push(
      entry.quote
        .trim()
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n"),
    );
  if (entry.body) parts.push(entry.body.trim());
  return `${parts.join("\n\n")}\n`;
}

/**
 * Appends one entry to the task's decision log (`<taskDir>/<name>`, named by the workflow), starting
 * the file with its title on first use. Entries are only ever appended.
 */
export async function appendHistory(taskDir: string, name: string, taskKey: string, entry: HistoryEntry): Promise<void> {
  const file = path.join(taskDir, name);
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  const head = exists ? "\n" : `${HISTORY_TEXT.title(taskKey)}\n\n`;
  await appendFile(file, head + formatEntry(entry));
}

/** The engine serializes callers. A durable marker makes request retries append-only and idempotent. */
export async function appendHandoffHistory(taskDir: string, name: string, taskKey: string, step: string, operation: HandoffJournal, sanitize: SafeText): Promise<void> {
  const marker = `<!-- taskpilot-handoff:${operation.operationId}:${operation.stage}:${operation.previewId}${operation.recovery ? `:recovery-${operation.recovery}` : ""} -->`;
  const current = await readFile(path.join(taskDir, name), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (current.includes(marker)) return;
  await appendHistory(taskDir, name, taskKey, {
    at: operation.updatedAt,
    step: sanitize(step, 500),
    source: operation.stage === "committed" && !operation.recovery ? HISTORY_TEXT.handoff : HISTORY_TEXT.handoffFailed,
    body: `${marker}\n${sanitize(operation.text, 32_000)}${operation.error ? `\n\n${sanitize(operation.error)}` : ""}`,
  });
}
