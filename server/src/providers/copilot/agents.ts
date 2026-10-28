import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { copilotHome } from "./home.js";

/** A custom agent Copilot can run with `--agent <name>`. */
export interface CopilotAgent {
  name: string;
  /** Absolute path of the agent file. */
  file: string;
  scope: "project" | "user";
  description?: string;
  /** Absent = the session's own model. */
  model?: string;
}

export class CopilotAgentError extends Error {
  constructor(
    readonly code: "invalidName" | "notFound" | "unreadable",
    message: string,
  ) {
    super(message);
  }
}

const NAME = /^[A-Za-z0-9][\w.-]{0,99}$/;

interface Location {
  dir: string;
  scope: CopilotAgent["scope"];
  suffixes: string[];
}

/** Where copilot 1.0.103 looks (verified with `--agent <unknown>`); first match wins, longer suffix first. */
function locations(repo: string): Location[] {
  const home = copilotHome();
  return [
    { dir: path.join(repo, ".github", "agents"), scope: "project", suffixes: [".agent.md", ".md"] },
    { dir: path.join(repo, ".claude", "agents"), scope: "project", suffixes: [".md"] },
    { dir: path.join(home, "agents"), scope: "user", suffixes: [".agent.md"] },
  ];
}

function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!match) return out;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

function load(name: string, file: string, scope: CopilotAgent["scope"]): CopilotAgent {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new CopilotAgentError("unreadable", `Copilot agent "${name}" cannot be read: ${(error as Error).message}`);
  }
  const meta = frontmatter(text);
  return { name, file, scope, ...(meta.description ? { description: meta.description } : {}), ...(meta.model ? { model: meta.model } : {}) };
}

function nameOf(file: string, suffixes: string[]): string | undefined {
  const suffix = suffixes.find((s) => file.endsWith(s));
  if (!suffix) return undefined;
  const name = file.slice(0, -suffix.length);
  return NAME.test(name) ? name : undefined;
}

/** Reads a custom agent by name; throws CopilotAgentError when it is missing or unusable. */
export function readCopilotAgent(repo: string, name: string): CopilotAgent {
  if (!NAME.test(name)) throw new CopilotAgentError("invalidName", `Copilot agent name "${name}" is not valid`);
  for (const { dir, scope, suffixes } of locations(repo)) {
    for (const suffix of suffixes) {
      const file = path.join(dir, `${name}${suffix}`);
      try {
        readFileSync(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      return load(name, file, scope);
    }
  }
  throw new CopilotAgentError("notFound", `Copilot agent "${name}" not found in .github/agents, .claude/agents or ~/.copilot/agents`);
}

/** Every custom agent Copilot would find for this repo, sorted by name; the first location wins on a clash. */
export function listCopilotAgents(repo: string): CopilotAgent[] {
  const found = new Map<string, CopilotAgent>();
  for (const { dir, scope, suffixes } of locations(repo)) {
    let files: string[];
    try {
      files = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const name = nameOf(file, suffixes);
      if (!name || found.has(name)) continue;
      try {
        found.set(name, load(name, path.join(dir, file), scope));
      } catch {
        // unreadable entry (e.g. a directory named x.md): skip it
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
