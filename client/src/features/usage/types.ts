export interface UsageWindow {
  usedPercentage: number;
  /** Epoch ms. */
  resetsAt: number | null;
}

/** Plan usage last reported by a session's status line; mirrors server/src/modules/usage/store.ts. */
export interface UsageView {
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  spend?: { usedPercentage: number };
  updatedAt: number;
}
