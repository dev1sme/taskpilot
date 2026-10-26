import { cliVersion } from "../cli-version.js";

/** The version in `codex --version` ("codex-cli 0.163.0"), or null. */
export function parseCodexVersion(output: string): string | null {
  return /\d+\.\d+\.\d+\S*/.exec(output)?.[0] ?? null;
}

/** `codex --version` once per server run; null when the command is missing or fails. */
export const codexVersion = cliVersion(() => process.env.TASKPILOT_CODEX ?? "codex", parseCodexVersion);
