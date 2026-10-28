import { execFile } from "node:child_process";
import type { ProviderId } from "@taskpilot/shared";
import { childEnv } from "../../../core/launch.js";
import { t } from "../../../core/i18n.js";
import type { ProviderBackend, ProviderCapability, BackendProbeContext, PreflightErrorCode, PreflightProblem } from "./types.js";

export function problem(agent: ProviderId, code: PreflightErrorCode, field: PreflightProblem["field"]): PreflightProblem {
  return { agent, code, field, message: t(`preflight.${code}`, { agent }) };
}

export function probeError(agent: ProviderId, error: unknown, field: PreflightProblem["field"]): PreflightProblem {
  const errno = (error as NodeJS.ErrnoException | null)?.code;
  return problem(
    agent,
    errno === "ENOENT" ? "missing_cli" : ["ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(errno ?? "") ? "network" : "probe_failed",
    field,
  );
}

export function emptyCapability(backend: Pick<ProviderBackend, "id" | "permissionModes" | "supportsSubagents">): ProviderCapability {
  return {
    agent: backend.id,
    checkedAt: Date.now(),
    cli: { status: "unknown", source: "unverified" },
    login: { status: "unknown", source: "unverified" },
    models: { status: "unknown", source: "unverified", items: [] },
    defaultModel: { kind: "agent-default" },
    permissionModes: [...backend.permissionModes],
    subagents: { status: backend.supportsSubagents ? "supported" : "unsupported", source: "adapter" },
    quotaDetection: { status: "unknown", source: "unverified" },
  };
}

/** Only --version: never starts a conversation or installs hooks. Login/inventory stay unknown. */
export async function probePty(backend: Pick<ProviderBackend, "id" | "permissionModes" | "supportsSubagents">, context: BackendProbeContext): Promise<ProviderCapability> {
  const capability = emptyCapability(backend);
  const result = await new Promise<{ version?: string; error?: PreflightProblem }>((resolve) => {
    execFile(
      context.command.file,
      ["--version"],
      { cwd: context.repo, env: childEnv(process.env, { ...context.extraEnv, ...context.command.env }), timeout: context.timeoutMs, killSignal: "SIGKILL", maxBuffer: 16_384 },
      (error, stdout) => {
        if (error) {
          resolve({ error: error.killed ? problem(backend.id, "timeout", "cli") : probeError(backend.id, error, "cli") });
          return;
        }
        // Return only a version number, never arbitrary CLI output (which can contain secrets).
        const version = /\b\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\b/.exec(stdout)?.[0];
        resolve(version ? { version } : { error: problem(backend.id, "protocol", "cli") });
      },
    );
  });
  capability.cli = result.error
    ? { status: result.error.code === "missing_cli" ? "unsupported" : "unknown", source: "cli-version", error: result.error }
    : { status: "supported", source: "cli-version", version: result.version };
  return capability;
}
