import { useQuery } from "@tanstack/react-query";
import { useInvalidateOnTaskEvent } from "../../shared/api/useInvalidateOnEvent";
import { workflowApi } from "./api";
import type { RunPhase } from "./types";

export const ACTIVE_PHASES: RunPhase[] = ["starting", "running", "waiting", "gate", "interrupted"];

/** The task's workflow and latest run, kept live through "run" events. */
export function useRun(taskKey: string) {
  const queryKey = ["run", taskKey];
  const query = useQuery({ queryKey, queryFn: () => workflowApi.run(taskKey) });
  useInvalidateOnTaskEvent("run", taskKey, queryKey);

  return {
    view: query.data ?? null,
    error: query.error ? (query.error as Error).message : null,
    reload: async () => void (await query.refetch()),
  };
}
