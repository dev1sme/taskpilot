import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frontmatter } from "../shared/fs.js";

/** <package>/subagents/claude; five levels up from both server/src/modules/config/library and dist/server/modules/config/library. */
export const SUBAGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../subagents/claude");

/** A subagent TaskPilot ships, written to the repo's .claude/agents/<name>.md. */
export interface AgentTemplate {
  name: string;
  /** Path inside .claude/agents. */
  rel: string;
  description: string;
  content: string;
}

export async function readTemplates(): Promise<AgentTemplate[]> {
  let names: string[];
  try {
    names = (await readdir(SUBAGENTS_DIR)).filter((n) => n.endsWith(".md")).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (file) => {
      const content = await readFile(path.join(SUBAGENTS_DIR, file), "utf8");
      const { meta } = frontmatter(content);
      const stem = path.basename(file, ".md");
      return {
        name: typeof meta.name === "string" && meta.name ? meta.name : stem,
        rel: file,
        description: typeof meta.description === "string" ? meta.description : "",
        content,
      };
    }),
  );
}
