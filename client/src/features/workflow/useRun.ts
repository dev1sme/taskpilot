import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useInvalidateOnTaskEvent } from "../../shared/api/useInvalidateOnEvent";
import { workflowApi } from "./api";
import type { RunPhase } from "../workspace";
import { useWorkspace } from "../workspace";

export const ACTIVE_PHASES: RunPhase[] = ["starting", "running", "waiting", "gate", "interrupted"];

/** The task's workflow and latest run, kept live through "run" events. */
export function useRun(taskKey: string) {
  const cache = useQueryClient();
  const { repo } = useWorkspace();
  const queryKey = ["run", taskKey, repo?.path];
  const query = useQuery({ queryKey, queryFn: () => workflowApi.run(taskKey), enabled: !!repo?.path });
  useInvalidateOnTaskEvent("run", taskKey, queryKey);

  return {
    view: query.data ?? null,
    error: query.error ? (query.error as Error).message : null,
    reload: async () => {
      await Promise.all([query.refetch(), cache.invalidateQueries({ queryKey: ["sessions", taskKey] })]);
    },
  };
}
