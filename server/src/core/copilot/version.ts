import { execFile } from "node:child_process";
import { childEnv } from "../claude/launch.js";

let cached: Promise<string | null> | null = null;

/** `copilot --version` once per server run ("GitHub Copilot CLI 1.0.100."); null when missing. */
export function copilotVersion(): Promise<string | null> {
  cached ??= new Promise((resolve) => {
    execFile(process.env.TASKPILOT_COPILOT ?? "copilot", ["--version"], { env: childEnv(), timeout: 10_000 }, (err, stdout) =>
      resolve(err ? null : (/\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? null)),
    );
  });
  return cached;
}
