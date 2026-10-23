import { CodexError } from "../../core/codex/errors.js";
import { t } from "../../core/i18n.js";

export type FailureReason = "quota" | "auth" | "model" | "cli" | "network" | "unknown";
type FailureCode = "usageLimitExceeded" | "unauthorized" | "http401" | "connection" | "missing" | "notLoggedIn" | "modelUnknown";

/** An allowlist projection: backend prose, stderr and account details never enter this DTO. */
export interface SessionFailure {
  reason: FailureReason;
  message: string;
  observedAt: number;
  generation?: number;
  evidence: {
    source: "codex-turn" | "codex-startup" | "unclassified";
    code?: FailureCode;
    threadId?: string;
    turnId?: string;
  };
}

export function unknownFailure(): SessionFailure {
  return failure("unknown", "unclassified");
}

function failure(reason: FailureReason, source: SessionFailure["evidence"]["source"], code?: FailureCode): SessionFailure {
  return { reason, message: t(`failure.${reason}`), observedAt: Date.now(), evidence: { source, ...(code ? { code } : {}) } };
}

/** Wire casing checked against `codex-cli 0.163.0 app-server generate-ts`, v2/CodexErrorInfo. */
export function codexTurnFailure(error: unknown, threadId: string, turnId: string): SessionFailure {
  const info = object(error).codexErrorInfo;
  let result = unknownFailure();
  if (info === "usageLimitExceeded") result = failure("quota", "codex-turn", info);
  else if (info === "unauthorized") result = failure("auth", "codex-turn", info);
  else {
    const entry = object(info);
    const connection = object(entry.httpConnectionFailed ?? entry.responseStreamConnectionFailed ?? entry.responseStreamDisconnected ?? entry.responseTooManyFailedAttempts);
    if (connection.httpStatusCode === 401) result = failure("auth", "codex-turn", "http401");
    else if (connection.httpStatusCode === null && ("responseStreamConnectionFailed" in entry || "responseStreamDisconnected" in entry)) {
      result = failure("network", "codex-turn", "connection");
    }
    // 429, rateLimitExceeded, other, timeouts and arbitrary text do not prove exhausted usage.
  }
  return { ...result, evidence: { ...result.evidence, threadId, turnId } };
}

export function codexStartupFailure(error: unknown): SessionFailure {
  if (error instanceof CodexError) {
    if (error.code === "missing") return failure("cli", "codex-startup", error.code);
    if (error.code === "notLoggedIn") return failure("auth", "codex-startup", error.code);
    if (error.code === "modelUnknown") return failure("model", "codex-startup", error.code);
  }
  return unknownFailure();
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
