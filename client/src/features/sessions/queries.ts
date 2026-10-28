import type { SessionView } from "@server/api-types";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/api";
import { useInvalidateOn } from "@/lib/events";
import { taskUrl } from "@/features/workspace/queries";

/** The task's sessions, live through "sessions" events. */
export function useSessions(taskKey: string) {
  const queryKey = ["sessions", taskKey];
  useInvalidateOn("sessions", queryKey, taskKey);
  return useQuery({ queryKey, queryFn: () => call<SessionView[]>("GET", `${taskUrl(taskKey)}/sessions`) });
}
