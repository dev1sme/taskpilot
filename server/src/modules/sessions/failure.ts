import { t } from "../../core/i18n.js";

export type FailureReason = "quota" | "auth" | "model" | "cli" | "network" | "unknown";

/** An allowlist projection: backend prose, stderr and account details never enter this DTO. */
export interface SessionFailure {
  reason: FailureReason;
  message: string;
  observedAt: number;
  generation?: number;
  evidence: {
    source: "unclassified";
  };
}

export function unknownFailure(): SessionFailure {
  return { reason: "unknown", message: t("failure.unknown"), observedAt: Date.now(), evidence: { source: "unclassified" } };
}
