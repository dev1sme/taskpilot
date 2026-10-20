import { useQuery } from "@tanstack/react-query";
import { useInvalidateOnTaskEvent } from "../../shared/api/useInvalidateOnEvent";
import { activityApi } from "./api";
import type { ActivityItem } from "./types";

/** Activity of every session of the task, oldest first; refetches on live "activity" events. */
export function useActivity(taskKey: string): ActivityItem[] {
  const queryKey = ["activity", taskKey];
  const query = useQuery({ queryKey, queryFn: () => activityApi.activity(taskKey) });
  useInvalidateOnTaskEvent("activity", taskKey, queryKey);

  return query.data ?? [];
}
