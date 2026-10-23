import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { frontmatter } from "../shared/fs.js";

/** Which CLI a template is for: Claude writes .claude/agents/<name>.md, Codex .codex/agents/<name>.toml. */
export type AgentCli = "claude" | "codex";

/** <package>/subagents; five levels up from both server/src/modules/config/library and dist/server/modules/config/library. */
const SUBAGENTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../subagents");
export const SUBAGENTS_DIR = path.join(SUBAGENTS_ROOT, "claude");
export const CODEX_SUBAGENTS_DIR = path.join(SUBAGENTS_ROOT, "codex");

/** A subagent TaskPilot ships, written to the repo's .claude/agents or .codex/agents. */
export interface AgentTemplate {
  name: string;
  /** Path inside the CLI's agents folder. */
  rel: string;
  description: string;
  content: string;
}

export async function readTemplates(cli: AgentCli = "claude"): Promise<AgentTemplate[]> {
  const dir = cli === "codex" ? CODEX_SUBAGENTS_DIR : SUBAGENTS_DIR;
  const ext = cli === "codex" ? ".toml" : ".md";
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(ext)).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (file) => {
      const content = await readFile(path.join(dir, file), "utf8");
      const meta = cli === "codex" ? tomlMeta(content) : frontmatter(content).meta;
      const stem = path.basename(file, ext);
      return {
        name: typeof meta.name === "string" && meta.name ? meta.name : stem,
        rel: file,
        description: typeof meta.description === "string" ? meta.description : "",
        content,
      };
    }),
  );
}

/** The top-level keys of a Codex agent file; a file that does not parse has none. */
export function tomlMeta(text: string): Record<string, unknown> {
  try {
    return parseToml(text);
  } catch {
    return {};
  }
}
