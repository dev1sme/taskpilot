import { execFile } from "node:child_process";
import os from "node:os";
import { childEnv } from "../../core/launch.js";
import { isObject } from "../../core/values.js";

const TIMEOUT_MS = 15_000;

export interface ClaudeUsageWindow {
  /** 0-100. */
  usedPercentage: number;
  /** Epoch ms; null when not given. */
  resetsAt: number | null;
}

/** Plan windows of `/usage`; a window the report lacks is absent. */
export interface ClaudeUsageFields {
  fiveHour?: ClaudeUsageWindow;
  sevenDay?: ClaudeUsageWindow;
}

/**
 * Reads the plan windows from the `usage_report` of a stream-json `/usage` run (experimental in
 * Claude Code): `session` is the 5-hour window, `weekly_all` the 7-day one. Null when the report
 * has neither (API key, gateway, missing scope, other shape).
 */
export function parseClaudeUsageReport(stdout: string): ClaudeUsageFields | null {
  for (const line of stdout.split("\n")) {
    if (!line.includes("usage_report")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const limits = limitsOf(event);
    if (!limits) continue;
    const fields: ClaudeUsageFields = {};
    for (const limit of limits) {
      if (!isObject(limit)) continue;
      const window = parseWindow(limit);
      if (!window) continue;
      if (limit.kind === "session") fields.fiveHour = window;
      else if (limit.kind === "weekly_all") fields.sevenDay = window;
    }
    if (fields.fiveHour || fields.sevenDay) return fields;
  }
  return null;
}

function limitsOf(event: unknown): unknown[] | null {
  if (!isObject(event)) return null;
  const message = isObject(event.message) ? event.message : null;
  const report = event.usage_report ?? message?.usage_report;
  if (!isObject(report) || !isObject(report.rate_limits)) return null;
  return Array.isArray(report.rate_limits.limits) ? report.rate_limits.limits : null;
}

function parseWindow(limit: Record<string, unknown>): ClaudeUsageWindow | null {
  const percent = limit.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  const at = typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) : NaN;
  return { usedPercentage: percent, resetsAt: Number.isFinite(at) ? at : null };
}

/**
 * Account plan usage from a short-lived `claude -p "/usage"` (no model call, no tokens). Runs in
 * the temp dir without a transcript and without TaskPilot's session variables. Null when Claude
 * is missing or reports no windows; rejects on other failures.
 */
export function fetchClaudeUsage(timeoutMs = TIMEOUT_MS): Promise<ClaudeUsageFields | null> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.TASKPILOT_CLAUDE ?? "claude",
      ["-p", "/usage", "--output-format", "stream-json", "--verbose", "--no-session-persistence"],
      { cwd: os.tmpdir(), env: childEnv(process.env), timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") resolve(null);
        else if (err && !stdout) reject(new Error(`claude /usage failed: ${err.message.split("\n")[0]?.slice(0, 200)}`));
        else resolve(parseClaudeUsageReport(stdout));
      },
    );
  });
}
