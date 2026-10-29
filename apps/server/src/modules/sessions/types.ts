import type { SessionMeta } from "../../core/state.js";
import type { AccountQuotaEvidence } from "../usage/index.js";
import type { Activity } from "./hooks.js";
import type { ProviderId } from "@taskpilot/shared";
import type { SessionObservation } from "../../core/observation-types.js";

/** TaskPilot does not classify failures yet: every one is "unknown". */
export type FailureReason = "unknown";

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

export type SessionStatus = "running" | "exited";

export interface SessionView extends SessionMeta {
  observation?: SessionObservation;
  agent: ProviderId;
  status: SessionStatus;
  exitCode: number | null;
  /** null while the session is not running. */
  activity: Activity | null;
  failure?: SessionFailure;
  accountQuota?: AccountQuotaEvidence;
}
