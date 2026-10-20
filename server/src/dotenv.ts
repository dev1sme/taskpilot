import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Loads `file` into process.env without overriding variables that are already set, so the
 * process environment wins over the file. Empty values count as unset. A missing file is fine.
 */
export function loadDotEnv(file: string, env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (value !== "" && env[key] === undefined) env[key] = value;
  }
}
