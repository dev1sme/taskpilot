import path from "node:path";

/** What a tool call does, for icon and color in the feed. */
export type ToolCategory = "read" | "write" | "run" | "search" | "web" | "agent" | "plan" | "other";

export interface ToolDescription {
  category: ToolCategory;
  /** One line in Vietnamese, e.g. "Đọc src/orders.ts". */
  summary: string;
  /** Longer text shown when the item is expanded (full command, pattern…). */
  detail?: string;
}

const MAX = 120;

/** Turns a hook's tool_name + tool_input into a feed line. Paths are shown relative to `cwd`. */
export function describeTool(tool: string, input: Record<string, unknown>, cwd: string): ToolDescription {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  const file = () => relative(str("file_path") || str("notebook_path") || str("path"), cwd);

  switch (tool) {
    case "Read":
      return { category: "read", summary: `Đọc ${file()}` };
    case "Write":
      return { category: "write", summary: `Ghi ${file()}` };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { category: "write", summary: `Sửa ${file()}` };
    case "Bash": {
      // The command itself is the most telling; Claude's own description goes to the detail.
      const command = str("command");
      const detail = [str("description"), command].filter(Boolean).join("\n\n");
      return { category: "run", summary: `Chạy ${clip(oneLine(command))}`, detail };
    }
    case "Grep": {
      const where = relative(str("path"), cwd);
      return {
        category: "search",
        summary: `Tìm "${clip(str("pattern"), 60)}"${where && where !== "." ? ` trong ${where}` : ""}`,
      };
    }
    case "Glob":
      return { category: "search", summary: `Tìm file ${clip(str("pattern"), 80)}` };
    case "WebFetch":
      return { category: "web", summary: `Mở ${clip(str("url"))}` };
    case "WebSearch":
      return { category: "web", summary: `Tìm trên web: ${clip(str("query"))}` };
    case "Task":
    case "Agent":
      return { category: "agent", summary: `Giao subagent: ${clip(str("description") || str("prompt"))}` };
    case "TodoWrite":
      return { category: "plan", summary: "Cập nhật danh sách việc" };
    default:
      return { category: "other", summary: tool.startsWith("mcp__") ? `Dùng ${tool.split("__").slice(1).join(" › ")}` : `Dùng ${tool}` };
  }
}

function relative(p: string, cwd: string): string {
  if (!p) return "";
  if (!path.isAbsolute(p)) return p;
  const rel = path.relative(cwd, p);
  if (rel === "") return ".";
  return !rel.startsWith("..") ? rel : p;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function clip(s: string, max = MAX): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function firstLine(s: string, max = MAX): string {
  return clip(oneLine(s.split("\n").find((l) => l.trim()) ?? ""), max);
}
