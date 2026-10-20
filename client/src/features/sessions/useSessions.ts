import { useQuery } from "@tanstack/react-query";
import { useInvalidateOnTaskEvent } from "../../shared/api/useInvalidateOnEvent";
import { sessionsApi } from "./api";
import { REPO_SESSION_KEY } from "./types";

export function useSessions(taskKey: string) {
  const queryKey = ["sessions", taskKey];
  const query = useQuery({ queryKey, queryFn: () => sessionsApi.sessions(taskKey) });
  useInvalidateOnTaskEvent("sessions", taskKey, queryKey);

  return {
    sessions: query.data ?? [],
    reload: async () => void (await query.refetch()),
  };
}

/** Sessions of the repo terminal. The repo path is in the key so switching repos refetches. */
export function useRepoSessions(repoPath: string | null) {
  const queryKey = ["sessions", REPO_SESSION_KEY, repoPath];
  const query = useQuery({ queryKey, queryFn: sessionsApi.repoSessions, enabled: !!repoPath });
  useInvalidateOnTaskEvent("sessions", REPO_SESSION_KEY, queryKey);

  return {
    sessions: (repoPath && query.data) || [],
    reload: async () => void (await query.refetch()),
  };
}
