import { execFile } from "node:child_process";
import { HttpError } from "../errors.js";
import { childEnv } from "../sessions/launch.js";

/** Runs `claude <args>` in the repo with the same environment TaskPilot gives its sessions. */
export function runClaude(
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.TASKPILOT_CLAUDE ?? "claude",
      args,
      { cwd: opts.cwd, env: childEnv(process.env, opts.env ?? {}), timeout: opts.timeoutMs ?? 30_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new HttpError(502, "Không tìm thấy lệnh claude"));
        } else if (err && !stdout) {
          // Messages from claude may echo the config; keep only the first line.
          reject(new HttpError(502, `claude ${args[0]} ${args[1] ?? ""} lỗi: ${firstLine(stderr || err.message)}`));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export type McpStatus = "connected" | "failed" | "pending" | "auth" | "unknown";

/**
 * Health of one MCP server as Claude sees it, from `claude mcp get`. Only the Status line is
 * used: the rest of that output prints environment values in clear.
 */
export async function checkMcp(
  name: string,
  opts: { cwd: string; env: Record<string, string> },
): Promise<{ status: McpStatus; label: string }> {
  const { stdout } = await runClaude(["mcp", "get", name], { ...opts, timeoutMs: 60_000 });
  const line = stdout.split("\n").find((l) => /^\s*Status:/.test(l));
  if (!line) return { status: "unknown", label: "Không đọc được trạng thái" };
  const label = line.replace(/^\s*Status:\s*/, "").replace(/^[^\p{L}]+/u, "").trim();
  const lower = label.toLowerCase();
  const status: McpStatus = lower.includes("pending approval")
    ? "pending"
    : lower.includes("auth")
      ? "auth"
      : lower.includes("failed")
        ? "failed"
        : lower.includes("connected")
          ? "connected"
          : "unknown";
  return { status, label };
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 200);
}
