/**
 * Copilot runtime tool names → Claude's, as Copilot itself maps them for hooks declared with
 * PascalCase names (docs.github.com/en/copilot/reference/hooks-reference).
 */
export const CLAUDE_TOOL_NAMES: Readonly<Record<string, string>> = {
  bash: "Bash",
  powershell: "Bash",
  view: "Read",
  create: "Write",
  edit: "Edit",
  str_replace_editor: "Edit",
  apply_patch: "Edit",
  grep: "Grep",
  rg: "Grep",
  glob: "Glob",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  ask_user: "AskUserQuestion",
  update_todo: "TodoWrite",
  task: "Agent",
};
