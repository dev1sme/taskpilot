import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { queryClient } from "../../shared/api/queryClient";
import { useInvalidateOnEvent } from "../../shared/api/useInvalidateOnEvent";
import { workspaceApi } from "./api";
import type { Info, Inventory, RepoInfo, TaskSummary } from "./types";

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
  const infoQuery = useQuery({ queryKey: ["info"], queryFn: workspaceApi.info });
  const repoQuery = useQuery({ queryKey: ["repo"], queryFn: workspaceApi.repo });
  const repo = repoQuery.data ?? null;

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: workspaceApi.tasks,
    enabled: !!repo?.path,
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: workspaceApi.inventory,
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
    const next = await workspaceApi.setRepo(path);
    // Drop responses and views of the old repo before mounting forms for the new one.
    const scoped = ["workflow-modes", "execution-defaults", "agent-capabilities", "run", "run-preview", "workflow", "sessions", "activity", "doc"];
    await Promise.all(scoped.map((key) => queryClient.cancelQueries({ queryKey: [key] })));
    for (const key of scoped) queryClient.removeQueries({ queryKey: [key] });
    queryClient.setQueryData(["repo"], next);
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["tasks"] }), queryClient.invalidateQueries({ queryKey: ["inventory"] })]);
  }, []);

  const error = repoQuery.error ? (repoQuery.error as Error).message : tasksQuery.error ? (tasksQuery.error as Error).message : null;

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
