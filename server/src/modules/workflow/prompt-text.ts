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
  /** Starting text of a prompt file added on the Workflow page, laid out like the built-in prompts. */
  newPrompt:
    '## Bối cảnh\n\nTask {{key}}: "{{title}}". Yêu cầu nằm trong {{specDir}}/.\n\n## Tài liệu cần viết\n\n{{outputs}}\n\n## Quy tắc\n\n{{rules}}\n\n{{language}}\n',
  /** The task the Workflow page previews prompts with: a sample, so no real task's state is implied. */
  sampleTask: { key: "TASK-1", title: "Tên task mẫu" },
  sampleArchive: "archive/<YYYYMMDD-HHMMSS>",
  sampleFeedback: "<góp ý của reviewer>",
  /** A subtask's own part of its prompt ({{subtask}}). */
  subtask: {
    heading: (n: number, title: string) => `Việc ${n}: ${title}`,
    output: (text: string) => `Đầu ra mong đợi: ${text}`,
    /** Only when the table names a subagent or a model; the session already runs with them. */
    runsAs: (subagent: string | undefined, model: string | undefined) =>
      `Chạy bằng ${[subagent ? `subagent \`${subagent}\`` : "", model ? `model \`${model}\`` : ""].filter(Boolean).join(", ")}.`,
    files: (files: string[]) => `File được sửa: ${files.map((f) => `\`${f}\``).join(", ")}`,
    noFiles: "File được sửa: leader không khai; chỉ sửa những gì việc này cần.",
    dependsOn: "Các việc trước đó đã xong; đọc báo cáo của chúng trước khi làm:",
    dependency: (report: string, n: number, title: string) => `- \`${report}\` (việc ${n}: ${title})`,
    noCommit:
      "Không commit: các việc có thể chạy song song và dùng chung working tree. Leader commit ở bước rà soát. Chỉ sửa các file đã liệt kê ở trên.",
    report: "báo cáo việc này: đã làm gì, file đã sửa, kết quả build/test, vướng mắc",
  },
  /** One line of {{subtasks}}, the list the leader reviews; `worker` is the agent with its subagent and model. */
  subtaskLine: (n: number, worker: string, title: string, report: string) => `- Việc ${n} · ${worker} · ${title} → \`${report}\``,
  sampleSubtask: { n: 1, title: "Tên việc mẫu", agent: "claude", files: ["đường/dẫn/file.ts"], output: "kết quả mẫu", deps: [] as number[] },
  restartLog: (historyFile: string) => `- ${historyFile} (entry "${HISTORY_TEXT.restart}" mới nhất và góp ý ngay trước nó)`,
} as const;
