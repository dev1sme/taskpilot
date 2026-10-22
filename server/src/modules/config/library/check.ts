import { t } from "../../../core/i18n.js";
import { isClaudeModel } from "../../workflow/index.js";
import { strings } from "../shared/fs.js";
import type { LibraryScope } from "./read.js";

/**
 * How a subagent can serve a TaskPilot workflow. `leader`: called by the leader through the Task
 * tool. `member`: runs a whole subtask session (`claude --agent`), so it must write its report.
 */
export type AgentRole = "leader" | "member";

export interface AgentCheck {
  status: "ok" | "warn" | "error";
  roles: AgentRole[];
  problems: string[];
  /** Same name as a TaskPilot template: whether the file still matches it. */
  template?: "same" | "modified";
}

/** Tools that write files; without one a member cannot write its report. */
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit"];

/** What one agent file says about itself, before it is compared with the others. */
export function checkAgent(meta: Record<string, unknown>, parseError: string | undefined): AgentCheck {
  if (parseError) return { status: "error", roles: [], problems: [parseError] };
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof meta.name !== "string" || !meta.name.trim()) errors.push(t("agentCheck.noName"));
  if (typeof meta.description !== "string" || !meta.description.trim()) errors.push(t("agentCheck.noDescription"));
  if (meta.model !== undefined && meta.model !== null) {
    const model = String(meta.model);
    if (!isClaudeModel(model)) errors.push(t("agentCheck.badModel", { model }));
  }

  // No `tools` means every tool of the session.
  const tools = meta.tools === undefined || meta.tools === null ? null : toolNames(meta.tools);
  const denied = toolNames(meta.disallowedTools);
  const canWrite = WRITE_TOOLS.some((w) => (tools === null || tools.includes(w)) && !denied.includes(w));
  if (tools?.includes("AskUserQuestion")) warnings.push(t("agentCheck.askUser"));
  // Read-only is a valid design for a leader's helper: noted, but it only limits the role.
  const notes = canWrite ? [] : [t("agentCheck.readOnly")];

  if (errors.length) return { status: "error", roles: [], problems: [...errors, ...warnings, ...notes] };
  const roles: AgentRole[] = canWrite ? ["leader", "member"] : ["leader"];
  return { status: warnings.length ? "warn" : "ok", roles, problems: [...warnings, ...notes] };
}

/**
 * Checks that need the whole list: a project agent hides a user agent of the same name, and two
 * files of one scope with the same name leave it unclear which one Claude Code picks.
 */
export function checkNames<T extends { name: string; scope: LibraryScope; check?: AgentCheck }>(items: T[]): void {
  for (const item of items) {
    if (!item.check) continue;
    const same = items.filter((o) => o !== item && o.name === item.name);
    if (item.scope === "user" && same.some((o) => o.scope === "project")) {
      item.check = { ...item.check, status: "warn", roles: [], problems: [...item.check.problems, t("agentCheck.shadowed")] };
    } else if (same.some((o) => o.scope === item.scope)) {
      const status = item.check.status === "error" ? "error" : "warn";
      item.check = { ...item.check, status, problems: [...item.check.problems, t("agentCheck.duplicate")] };
    }
  }
}

function toolNames(v: unknown): string[] {
  // Entries may carry a pattern, as in "Bash(git *)".
  return strings(v).map((s) => s.replace(/\(.*$/, "").trim());
}
