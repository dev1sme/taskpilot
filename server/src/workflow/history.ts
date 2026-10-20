import { appendFile, stat } from "node:fs/promises";
import path from "node:path";

/** Decision log of a task, next to its other documents; entries are only ever appended. */
export const HISTORY_FILE = "00-history.md";

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
  cancel: "Huỷ quy trình",
  restart: "Chạy lại từ đầu",
  archived: (dir: string, files: string[]) => `Bản cũ: ${dir}/ (${files.join(", ")})`,
  nothingArchived: "Chưa có tài liệu nào để lưu bản cũ.",
  interrupted: "Gián đoạn",
  serverRestarted: "TaskPilot khởi động lại giữa bước.",
  sessionStopped: "Session dừng giữa bước.",
} as const;

// "2026-10-20 14:03" in the server's time zone.
const TIME = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function formatEntry(entry: HistoryEntry): string {
  const parts = [`## ${TIME.format(entry.at)} · ${entry.step} · ${entry.source}`];
  if (entry.quote !== undefined) parts.push(entry.quote.trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
  if (entry.body) parts.push(entry.body.trim());
  return `${parts.join("\n\n")}\n`;
}

/** Appends one entry to `<taskDir>/00-history.md`, starting the file with its title on first use. */
export async function appendHistory(taskDir: string, taskKey: string, entry: HistoryEntry): Promise<void> {
  const file = path.join(taskDir, HISTORY_FILE);
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  const head = exists ? "\n" : `${HISTORY_TEXT.title(taskKey)}\n\n`;
  await appendFile(file, head + formatEntry(entry));
}
