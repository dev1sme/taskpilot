import type { UsageView } from "@taskpilot/server/api-types";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { call } from "@/lib/api";
import { onServerEvent } from "@/lib/events";
import { queryClient } from "@/lib/query-client";

/** Account usage of every agent; the server pushes each change, so the answer is replaced in place. */
export function useUsage() {
  useEffect(() => onServerEvent("usage", (data) => queryClient.setQueryData(["usage"], data as UsageView)), []);
  return useQuery({ queryKey: ["usage"], queryFn: () => call<UsageView | null>("GET", "/api/usage") });
}

/** The highest share used of any window that has not reset yet: what the status bar shows. */
export function peakUsage(usage: UsageView | null | undefined, now: number): number | null {
  if (!usage) return null;
  const live = (w: { usedPercentage: number | null; resetsAt?: number | null } | undefined) =>
    w && w.usedPercentage !== null && (w.resetsAt == null || w.resetsAt > now) ? w.usedPercentage : null;
  const values = [usage.fiveHour, usage.sevenDay, usage.spend, usage.agents?.codex?.fiveHour, usage.agents?.codex?.sevenDay, usage.agents?.copilot]
    .map(live)
    .filter((v): v is number => v !== null);
  return values.length ? Math.max(...values) : null;
}
