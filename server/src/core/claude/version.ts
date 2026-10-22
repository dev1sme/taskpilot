import { execFile } from "node:child_process";
import { childEnv } from "./launch.js";

let cached: Promise<string | null> | null = null;

/** `claude --version` once per server run; null when the command is missing or fails. */
export function claudeVersion(): Promise<string | null> {
  cached ??= new Promise((resolve) => {
    execFile(process.env.TASKPILOT_CLAUDE ?? "claude", ["--version"], { env: childEnv(), timeout: 10_000 }, (err, stdout) => resolve(err ? null : (stdout.trim().split(/\s+/)[0] ?? null)));
  });
  return cached;
}
