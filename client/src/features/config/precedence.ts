import type { LibraryKind, Scope } from "../../api/types";
import { SCOPE_LABEL } from "./parts";

export type PrecedenceKind = LibraryKind | "mcp";

/**
 * Which scope Claude Code loads when two define the same name, highest first. From the Claude Code
 * docs: /en/mcp "Scope hierarchy and precedence", /en/sub-agents "Choose the subagent scope",
 * /en/skills "Where skills live" (commands follow skills, and a skill beats a command of the same name).
 */
export const PRECEDENCE: Record<PrecedenceKind, Scope[]> = {
  mcp: ["local", "project", "user"],
  agents: ["project", "user"],
  skills: ["user", "project"],
  commands: ["user", "project"],
};

export function precedenceHint(kind: PrecedenceKind): string {
  const order = PRECEDENCE[kind].map((s) => SCOPE_LABEL[s]).join(" > ");
  return kind === "commands" ? `Trùng tên: ${order}; skill cùng tên thắng command.` : `Trùng tên: ${order}.`;
}

interface Named {
  name: string;
  scope: Scope;
}

/** Why Claude Code does not load `item`, or null when it does. `skills` is only used for commands. */
export function shadowOf(kind: PrecedenceKind, item: Named, all: Named[], skills: Named[] = []): { short: string; long: string } | null {
  if (kind === "commands") {
    const skill = skills.find((s) => s.name === item.name);
    if (skill) return { short: "Bị skill che", long: `Skill /${skill.name} (${SCOPE_LABEL[skill.scope]}) cùng tên được ưu tiên; Claude không dùng command này.` };
  }
  const order = PRECEDENCE[kind];
  const winner = all
    .filter((o) => o.name === item.name && order.indexOf(o.scope) < order.indexOf(item.scope))
    .sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope))[0];
  if (!winner) return null;
  const by = SCOPE_LABEL[winner.scope];
  return { short: `Bị ${by} che`, long: `Bản cùng tên ở scope ${by} được ưu tiên; Claude không nạp bản này.` };
}
