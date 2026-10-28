import type { ProviderId, SessionView } from "@server/api-types";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/api";
import { useInvalidateOn } from "@/lib/events";
import { taskUrl, useRepo } from "@/features/workspace/queries";

/** Session key of the repo terminal (sessions without a task); never a valid task key. */
export const REPO_SESSION_KEY = "@repo";

export const sessionsApi = {
  list: (key: string) => call<SessionView[]>("GET", `${taskUrl(key)}/sessions`),
  create: (key: string, agent: ProviderId) => call<SessionView>("POST", `${taskUrl(key)}/sessions`, { agent }),
  resume: (id: string) => call<SessionView>("POST", `/api/sessions/${id}/resume`),
  stop: (id: string) => call<{ ok: true }>("POST", `/api/sessions/${id}/stop`),
  forget: (id: string) => call<{ ok: true }>("DELETE", `/api/sessions/${id}`),
  repoList: () => call<SessionView[]>("GET", "/api/repo/sessions"),
  createRepo: (agent: ProviderId) => call<SessionView>("POST", "/api/repo/sessions", { agent }),
  ptyUrl: (id: string) => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/sessions/${id}/pty`,
};

/** The task's sessions, live through "sessions" events. */
export function useSessions(taskKey: string) {
  const queryKey = ["sessions", taskKey];
  useInvalidateOn("sessions", queryKey, taskKey);
  return useQuery({ queryKey, queryFn: () => sessionsApi.list(taskKey) });
}

/** Sessions of the repo terminal; the repo path is in the key so a repo switch refetches. */
export function useRepoSessions() {
  const repo = useRepo().data?.path;
  const queryKey = ["sessions", REPO_SESSION_KEY, repo];
  useInvalidateOn("sessions", queryKey, REPO_SESSION_KEY);
  return useQuery({ queryKey, queryFn: sessionsApi.repoList, enabled: Boolean(repo) });
}
