import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { CodexError } from "./errors.js";

/** What a Codex session takes from a custom agent file in `<repo>/.codex/agents/<name>.toml`. */
export interface CodexAgent {
  name: string;
  developerInstructions: string;
  /** Absent = the session's own model. */
  model?: string;
}

const NAME = /^[A-Za-z0-9][\w.-]{0,99}$/;

/** Reads a custom agent by file name; throws CodexError("subagentUnsupported") when it is missing or unusable. */
export function readCodexAgent(repo: string, name: string): CodexAgent {
  if (!NAME.test(name)) throw new CodexError("subagentUnsupported", `Codex agent name "${name}" is not valid`);
  const file = path.join(repo, ".codex", "agents", `${name}.toml`);
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(readFileSync(file, "utf8"));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new CodexError("subagentUnsupported", missing ? `Codex agent "${name}" not found at ${file}` : `Codex agent "${name}" cannot be read: ${(error as Error).message}`);
  }
  const instructions = doc.developer_instructions;
  if (typeof instructions !== "string" || !instructions.trim()) throw new CodexError("subagentUnsupported", `Codex agent "${name}" has no developer_instructions`);
  const model = typeof doc.model === "string" && doc.model.trim() ? doc.model.trim() : undefined;
  return { name, developerInstructions: instructions, ...(model ? { model } : {}) };
}
