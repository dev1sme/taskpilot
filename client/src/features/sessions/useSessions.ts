import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useInvalidateOnTaskEvent } from "../../api/useInvalidateOnEvent";

export function useSessions(taskKey: string) {
  const queryKey = ["sessions", taskKey];
  const query = useQuery({ queryKey, queryFn: () => api.sessions(taskKey) });
  useInvalidateOnTaskEvent("sessions", taskKey, queryKey);

  return {
    sessions: query.data ?? [],
    reload: async () => void (await query.refetch()),
  };
}
