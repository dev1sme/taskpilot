import { HISTORY_TEXT } from "./history.js";

/**
 * Prompt wording TaskPilot adds around the workflow's own templates. Not part of the UI resources:
 * like the decision log, it is text Claude reads, written in Vietnamese as the built-in prompts are.
 */
export const PROMPT_TEXT = {
  skeleton: "Tài liệu có khung: giữ heading đúng thứ tự, điền mọi mục, bỏ gợi ý <!-- -->.",
  restarted: (dir: string, files: string[]) =>
    `Task này được chạy lại từ bước đầu. Tài liệu của lần chạy trước đã được lưu vào\n${dir}/ (${files.join(", ")}).`,
  restartedEmpty: "Task này được chạy lại từ bước đầu; lần chạy trước chưa có tài liệu nào để lưu.",
  readFirst: "Trước tiên, đọc các file sau để biết lần trước đã làm gì và vì sao chạy lại:",
  restartLog: (historyFile: string) => `- ${historyFile} (entry "${HISTORY_TEXT.restart}" mới nhất và góp ý ngay trước nó)`,
} as const;
