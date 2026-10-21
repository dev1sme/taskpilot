import { appendFile, stat } from "node:fs/promises";
import path from "node:path";

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

/**
 * Wording of the entries TaskPilot writes. Not part of the UI resources: the log is a task document
 * that Claude reads back, so it stays in Vietnamese whatever the UI language.
 */
export const HISTORY_TEXT = {
  title: (taskKey: string) => `# ${taskKey} — Lịch sử quyết định`,
  start: "Bắt đầu quy trình",
  startBody: (source: string, steps: number) => `Quy trình: ${source}, ${steps} bước.`,
  defaultSource: "mặc định của TaskPilot",
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
  switchAgentBody: (from: string, to: string) => `Bước này chạy bằng ${to} trong session mới; session ${from} của bước trước đã dừng.`,
  dispatch: "Giao việc",
  dispatchBody: (items: Array<{ n: number; agent: string; title: string; deps: number[] }>, parallel: number) =>
    [
      ...items.map((a) => `${a.n}. ${a.agent} — ${a.title}${a.deps.length ? ` (sau việc ${a.deps.join(", ")})` : ""}`),
      parallel > 1 ? `\nChạy tối đa ${parallel} việc cùng lúc.` : "",
    ]
      .join("\n")
      .trim(),
  subtaskDone: (n: number, agent: string) => `Việc ${n} xong · ${agent}`,
  subtaskReply: (n: number) => `Ba trả lời việc ${n}`,
  subtaskInterrupted: (n: number) => `Việc ${n} gián đoạn`,
  subtaskSessionStopped: "Session của việc dừng giữa chừng.",
  backToLeader: "Về leader rà soát",
  backToLeaderBody: (done: number) => `${done} việc đã xong; leader rà soát báo cáo của chúng.`,
} as const;

// "2026-10-20 14:03" in the server's time zone.
const TIME = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function formatEntry(entry: HistoryEntry): string {
  const parts = [`## ${TIME.format(entry.at)} · ${entry.step} · ${entry.source}`];
  if (entry.quote !== undefined) parts.push(entry.quote.trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
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
