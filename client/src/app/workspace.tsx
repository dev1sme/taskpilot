import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { api } from "../api/client";
import { queryClient } from "../api/queryClient";
import { useInvalidateOnEvent } from "../api/useInvalidateOnEvent";
import type { Info, Inventory, RepoInfo, TaskSummary } from "../api/types";

interface Workspace {
  repo: RepoInfo | null;
  tasks: TaskSummary[];
  inventory: Inventory | null;
  info: Info | null;
  error: string | null;
  openRepo: (path: string) => Promise<void>;
  reloadInventory: () => Promise<void>;
}

const Ctx = createContext<Workspace | null>(null);

/** Repo-wide state shared by every page: the repo, its tasks (live), config inventory, claude version. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const infoQuery = useQuery({ queryKey: ["info"], queryFn: api.info });
  const repoQuery = useQuery({ queryKey: ["repo"], queryFn: api.repo });
  const repo = repoQuery.data ?? null;

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
    enabled: !!repo?.path,
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: api.inventory,
    enabled: !!repo?.path,
  });

  // Run phase, sessions and permission prompts all change what the task list shows.
  useInvalidateOnEvent("tasks", ["tasks"]);
  useInvalidateOnEvent("repo", ["tasks"]);
  useInvalidateOnEvent("run", ["tasks"]);
  useInvalidateOnEvent("sessions", ["tasks"]);

  const reloadInventory = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }, []);

  const openRepo = useCallback(async (path: string) => {
    queryClient.setQueryData(["repo"], await api.setRepo(path));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
    ]);
  }, []);

  const error = repoQuery.error
    ? (repoQuery.error as Error).message
    : tasksQuery.error
      ? (tasksQuery.error as Error).message
      : null;

  return (
    <Ctx.Provider
      value={{
        repo,
        tasks: tasksQuery.data ?? [],
        inventory: inventoryQuery.data ?? null,
        info: infoQuery.data ?? null,
        error,
        openRepo,
        reloadInventory,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace outside WorkspaceProvider");
  return ws;
}
