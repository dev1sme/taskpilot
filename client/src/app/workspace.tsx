import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { onServerEvent } from "../api/events";
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
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.tasks());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reloadInventory = useCallback(async () => {
    try {
      setInventory(await api.inventory());
    } catch {
      setInventory(null);
    }
  }, []);

  useEffect(() => {
    void api.info().then(setInfo).catch(() => setInfo(null));
    api
      .repo()
      .then((r) => {
        setRepo(r);
        if (r.path) {
          void loadTasks();
          void reloadInventory();
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [loadTasks, reloadInventory]);

  useEffect(() => {
    // Run phase, sessions and permission prompts all change what the task list shows.
    const offs = ["tasks", "repo", "run", "sessions"].map((e) => onServerEvent(e, () => void loadTasks()));
    return () => offs.forEach((off) => off());
  }, [loadTasks]);

  const openRepo = useCallback(
    async (path: string) => {
      setRepo(await api.setRepo(path));
      await Promise.all([loadTasks(), reloadInventory()]);
    },
    [loadTasks, reloadInventory],
  );

  return (
    <Ctx.Provider value={{ repo, tasks, inventory, info, error, openRepo, reloadInventory }}>{children}</Ctx.Provider>
  );
}

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace outside WorkspaceProvider");
  return ws;
}
