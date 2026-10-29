/** Missing data and a measured zero have different meanings. */
export type ObservationState = "available" | "missing" | "unsupported" | "unverified" | "stale";
export type ObservationReason =
  "no-hook" | "runtime-unverified" | "no-source" | "file-missing" | "file-unreadable" | "invalid-rollout" | "no-sample" | "identity-mismatch" | "older-sample" | "source-changed";

export interface ObservationAvailability {
  state: ObservationState;
  reason?: ObservationReason;
  /** Time of the check, not the last successful measurement. */
  checkedAt?: number;
}

/** Source ordering evidence. No transcript paths. */
export interface MetricSample {
  nativeId: string;
  fileId: string;
  offset: number;
  at?: number;
}

export interface SessionObservation {
  hooks: ObservationAvailability;
  childLifecycle: ObservationAvailability;
  compaction: ObservationAvailability;
  sessionEnd: ObservationAvailability;
}
