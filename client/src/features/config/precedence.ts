import { scopeLabel } from "./parts";
import type { LibraryKind, Scope } from "./types";

/**
 * Which scope Claude Code loads when two define the same name, highest first. From the Claude Code
 * docs: /en/mcp "Scope hierarchy and precedence", /en/sub-agents "Choose the subagent scope",
 * /en/skills "Where skills live" (commands follow skills).
 */
const PRECEDENCE: Record<LibraryKind | "mcp", Scope[]> = {
  mcp: ["local", "project", "user"],
  agents: ["project", "user"],
  skills: ["user", "project"],
  commands: ["user", "project"],
};

/** Label of the scope whose same-named entry Claude Code loads instead of `item`, or null. */
export function shadowedBy(kind: LibraryKind | "mcp", item: { name: string; scope: Scope }, all: Array<{ name: string; scope: Scope }>): string | null {
  const rank = (s: Scope) => PRECEDENCE[kind].indexOf(s);
  const winner = all.filter((o) => o.name === item.name && rank(o.scope) < rank(item.scope)).sort((a, b) => rank(a.scope) - rank(b.scope))[0];
  return winner ? scopeLabel(winner.scope) : null;
}
