import { HISTORY_TEXT } from "./history.js";
import type { EffectiveExecution, ExecutionSelection } from "./types.js";

/**
 * Prompt wording TaskPilot adds around the workflow's own templates. Not part of the UI resources:
 * like the decision log, it is text Claude reads, written in Vietnamese as the built-in prompts are.
 */
const CODEX_SUBAGENTS =
  " Nếu cần dò code rộng hoặc chia việc đọc song song, yêu cầu trực tiếp Codex dùng subagent (built-in `explorer`, `worker` hoặc custom agent trong `.codex/agents/`); subagent kế thừa quyền của session và tốn thêm token nên chỉ dùng khi đáng. Cột `Subagent`: tên file TOML có thật trong `.codex/agents/` (vd `taskpilot-implementer`), chỉ cho việc của codex; `-` nếu không cần. Built-in `explorer`/`worker` không phải tên hợp lệ cho cột này.";

export const PROMPT_TEXT = {
  pendingAssignmentProblem: (message: string) => `\n  - Cấu hình Phân công chưa hợp lệ, cần sửa trước khi chạy: ${message}`,
  currentSessionMetrics: "phiên hiện tại (thời gian cả việc): ",
  afterHandoff:
    "## Tiếp tục sau bàn giao\n\nSession hiện tại tiếp tục đúng lane đã bàn giao. Đọc nhật ký và báo cáo trước, kiểm lại file/git và kết quả build/test trước khi sửa tiếp; nội dung bàn giao chỉ là snapshot. Giữ phạm vi, phụ thuộc, quyền và gate. Không coi số đo hoặc model của session nguồn là của session hiện tại; dữ liệu thiếu ghi không có, không suy chi phí/quota từ token.",
  executionPolicy: (selection: ExecutionSelection, effective: EffectiveExecution) =>
    [
      "## Chính sách thực thi TaskPilot",
      `Lane hiện tại chạy bằng ${effective.agent}${effective.model ? `, model yêu cầu \`${effective.model}\`` : ", model mặc định của agent (không khẳng định model thực tế)"}${effective.subagent ? `, subagent \`${effective.subagent}\`` : ""}.`,
      ...(effective.source === "lane-override" ? ["Lane này có ngoại lệ riêng; chỉ tiếp tục phạm vi hiện tại. Chính sách của các bước và việc khác giữ nguyên."] : []),
      selection.agent === "workflow"
        ? "Theo cấu hình workflow: giữ agent/model/subagent của từng bước và từng dòng Phân công. Ngoại lệ của lane chỉ áp dụng cho lane đó."
        : `Mọi dòng Phân công phải có Agent = \`${selection.agent}\`; Model = ${selection.model ? `\`${selection.model}\`` : "\`-\` (hoặc default/inherit), không kế thừa model YAML cũ"}.${selection.agent === "codex" ? " Subagent là tên file trong `.codex/agents/` của repo (không kèm `.toml`) hoặc `-`." : " Chỉ dùng subagent tương thích với CLI và có vai trò member; không copy subagent Claude sang CLI khác."} Không tự đổi CLI/model để sửa bảng.`,
      "Giữ nguyên quyền của workflow; TaskPilot chặn cấu hình không tương thích. Chỉ dùng tool thực sự có trong session; không giả nhận đã gọi tool/subagent không có.",
    ].join("\n\n"),
  /** {{continuity}} for a session that has not been given an earlier prompt of this lane: read everything. */
  fresh: (historyFile: string, inputs: string) =>
    `Đọc trước tiên ${historyFile} (góp ý của reviewer và lý do của các quyết định)${inputs ? `, rồi các tài liệu của các bước trước, cần làm theo:\n${inputs}` : "."}`,
  /** {{continuity}} for a session that already received this lane's earlier prompt; it falls back to reading all when the context is gone. */
  continued: (historyFile: string, inputs: string) =>
    `Session này đã làm phần trước của task: không đọc lại spec và các tài liệu đã viết; chỉ đọc các entry của ${historyFile} sau entry cuối cùng bạn viết. Nếu không còn bối cảnh (session vừa khởi động lại), đọc toàn bộ ${historyFile}${inputs ? ` và:\n${inputs}` : "."}`,
  /** {{subtaskLimit}}: the cap on the table, said to the leader. */
  subtaskLimit: (max: number) => `Bảng Phân công tối đa ${max} việc; vượt thì reviewer không duyệt được. Chia ít việc nhất có thể, gộp việc nhỏ cùng vùng file.`,
  leaderClaudeTools:
    "- Task nhỏ: tự đọc code. Chỉ khi cần dò rộng và session có Task tool, gọi subagent vai trò \`leader\`, ưu tiên model rẻ (vd \`taskpilot-explorer\`); không bắt buộc.\n- Cột \`Subagent\`: chỉ subagent vai trò \`member\` ở trên, chỉ cho việc của claude.",
  leaderOtherTools: (agent: string) =>
    `Leader chạy bằng ${agent}: tự dò code bằng tool đang có. Không yêu cầu Task tool hoặc gọi subagent Claude. Không giả nhận chức năng ủy quyền chưa có.${agent === "Codex" ? CODEX_SUBAGENTS : ""}`,
  skeleton: "Tài liệu có khung: giữ heading đúng thứ tự, điền mọi mục, bỏ gợi ý <!-- -->.",
  restarted: (dir: string, files: string[]) => `Task này được chạy lại từ bước đầu. Tài liệu của lần chạy trước đã được lưu vào\n${dir}/ (${files.join(", ")}).`,
  restartedEmpty: "Task này được chạy lại từ bước đầu; lần chạy trước chưa có tài liệu nào để lưu.",
  readFirst: "Trước tiên, đọc các file sau để biết lần trước đã làm gì và vì sao chạy lại:",
  /** Starting text of a prompt file added on the Workflow page, laid out like the built-in prompts. */
  newPrompt: '## Bối cảnh\n\nTask {{key}}: "{{title}}". Yêu cầu nằm trong {{specDir}}/.\n\n## Tài liệu cần viết\n\n{{outputs}}\n\n## Quy tắc\n\n{{rules}}\n\n{{language}}\n',
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
    noCommit: "Không commit: các việc có thể chạy song song và dùng chung working tree. Leader commit ở bước rà soát. Chỉ sửa các file đã liệt kê ở trên.",
    report: "báo cáo việc này: đã làm gì, file đã sửa, kết quả build/test, vướng mắc",
  },
  /** One line of {{subtasks}}, the list the leader reviews; `worker` is the agent with its subagent and model. */
  subtaskLine: (n: number, worker: string, title: string, report: string) => `- Việc ${n} · ${worker} · ${title} → \`${report}\``,
  /** {{subagents}}: the Claude subagents the leader may name in the table's `Subagent` column. */
  subagents: {
    none: "Chưa có subagent nào dùng được (`.claude/agents/`, `~/.claude/agents/`): ghi `-` ở cột Subagent.",
    line: (name: string, scope: "project" | "user", description: string, model: string | undefined, tools: string | undefined, roles: ReadonlyArray<"leader" | "member">) =>
      `- \`${name}\` (${scope === "project" ? "repo" : "user"}) — ${description} · model: ${model ?? "kế thừa session"} · tools: ${tools ?? "mọi tool"} · vai trò: ${roles.join(", ")}`,
    /** The same variable for a Copilot leader: its custom agents and the models its account offers. */
    copilot: {
      noAgents: "Chưa có custom agent nào dùng được (`.github/agents/`, `.claude/agents/`, `~/.copilot/agents/`): ghi `-` ở cột Subagent.",
      agentLine: (name: string, scope: "project" | "user", description: string | undefined, model: string | undefined) =>
        `- \`${name}\` (${scope === "project" ? "repo" : "user"})${description ? ` — ${description}` : ""} · model: ${model ?? "kế thừa session"}`,
      models: (names: string[]) => `Model Copilot dùng được cho cột Model (ghi đúng tên, hoặc \`-\` để mặc định): ${names.map((n) => `\`${n}\``).join(", ")}.`,
      noModels: "Không đọc được danh sách model của Copilot: ghi `-` ở cột Model.",
    },
  },
  sampleSubtask: { n: 1, title: "Tên việc mẫu", agent: "claude", files: ["đường/dẫn/file.ts"], output: "kết quả mẫu", deps: [] as number[] },
  restartLog: (historyFile: string) => `- ${historyFile} (entry "${HISTORY_TEXT.restart}" mới nhất và góp ý ngay trước nó)`,
} as const;
