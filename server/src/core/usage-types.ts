export interface UsageWindow {
  /** 0-100. */
  usedPercentage: number;
  /** Epoch ms; null when not given. */
  resetsAt: number | null;
}
