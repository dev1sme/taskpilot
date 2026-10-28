import type { Inventory, RepoInfo, ServerInfo, TaskDetail, TaskListItem } from "@taskpilot/server/api-types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { call, query } from "@/lib/api";
import { useInvalidateOn } from "@/lib/events";
import { queryClient } from "@/lib/query-client";

export const taskUrl = (key: string) => `/api/tasks/${encodeURIComponent(key)}`;

export const workspaceApi = {
  info: () => call<ServerInfo>("GET", "/api/info"),
  inventory: () => call<Inventory>("GET", "/api/inventory"),
  repo: () => call<RepoInfo>("GET", "/api/repo"),
  setRepo: (path: string) => call<RepoInfo>("PUT", "/api/repo", { path }),
  tasks: () => call<TaskListItem[]>("GET", "/api/tasks"),
  task: (key: string) => call<TaskDetail>("GET", taskUrl(key)),
  file: (key: string, path: string) => call<{ path: string; content: string }>("GET", `${taskUrl(key)}/file${query({ path })}`),
};

export const useServerInfo = () => useQuery({ queryKey: ["info"], queryFn: workspaceApi.info });

export const useRepo = () => useQuery({ queryKey: ["repo"], queryFn: workspaceApi.repo });

/** The repo's tasks, live: runs, sessions and permission prompts all change what the list shows. */
export function useTasks() {
  const repo = useRepo().data;
  useInvalidateOn("tasks", ["tasks"]);
  useInvalidateOn("repo", ["tasks"]);
  useInvalidateOn("run", ["tasks"]);
  useInvalidateOn("sessions", ["tasks"]);
  return useQuery({ queryKey: ["tasks"], queryFn: workspaceApi.tasks, enabled: Boolean(repo?.path) });
}

export function useInventory() {
  const repo = useRepo().data;
  return useQuery({ queryKey: ["inventory"], queryFn: workspaceApi.inventory, enabled: Boolean(repo?.path) });
}

/** Switches repo: every repo-scoped answer is dropped before the pages ask again. */
export function useOpenRepo() {
  return useMutation({
    mutationFn: workspaceApi.setRepo,
    onSuccess: async (next) => {
      const keep = new Set(["info", "repo"]);
      await queryClient.cancelQueries({ predicate: (q) => !keep.has(String(q.queryKey[0])) });
      queryClient.removeQueries({ predicate: (q) => !keep.has(String(q.queryKey[0])) });
      queryClient.setQueryData(["repo"], next);
    },
  });
}

/** The repo folder's name, for headers and the sidebar. */
export const repoName = (path: string | null | undefined): string | null => path?.split(/[\\/]/).filter(Boolean).pop() ?? null;
