import { execFile } from "node:child_process";
import { childEnv } from "../claude/launch.js";

let cached: Promise<string | null> | null = null;

/** The version in `codex --version` ("codex-cli 0.163.0"), or null. */
export function parseCodexVersion(output: string): string | null {
  return /\d+\.\d+\.\d+\S*/.exec(output)?.[0] ?? null;
}

/** `codex --version` once per server run; null when the command is missing or fails. */
export function codexVersion(): Promise<string | null> {
  cached ??= new Promise((resolve) => {
    execFile(process.env.TASKPILOT_CODEX ?? "codex", ["--version"], { env: childEnv(), timeout: 10_000 }, (err, stdout) => resolve(err ? null : parseCodexVersion(stdout)));
  });
  return cached;
}
