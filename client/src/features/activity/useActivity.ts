import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useInvalidateOnTaskEvent } from "../../api/useInvalidateOnEvent";
import type { ActivityItem } from "../../api/types";

/** Activity of every session of the task, oldest first; refetches on live "activity" events. */
export function useActivity(taskKey: string): ActivityItem[] {
  const queryKey = ["activity", taskKey];
  const query = useQuery({ queryKey, queryFn: () => api.activity(taskKey) });
  useInvalidateOnTaskEvent("activity", taskKey, queryKey);

  return query.data ?? [];
}
