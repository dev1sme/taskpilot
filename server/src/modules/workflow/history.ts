import { appendFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SubtaskMetrics } from "./types.js";

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
  subtaskDoneBody: (report: string, m?: SubtaskMetrics) => `Báo cáo: ${report}${m ? `\nSố liệu: ${metrics(m)}` : ""}`,
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
