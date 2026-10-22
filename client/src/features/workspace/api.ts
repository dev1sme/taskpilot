import { call, taskUrl } from "../../shared/api/http";
import type { Info, Inventory, RepoInfo, TaskSummary } from "./types";

export const workspaceApi = {
  info: () => call<Info>("GET", "/api/info"),
  inventory: () => call<Inventory>("GET", "/api/inventory"),
  repo: () => call<RepoInfo>("GET", "/api/repo"),
  setRepo: (path: string) => call<RepoInfo>("PUT", "/api/repo", { path }),
  tasks: () => call<TaskSummary[]>("GET", "/api/tasks"),
  file: (key: string, path: string) => call<{ path: string; content: string }>("GET", `${taskUrl(key)}/file?path=${encodeURIComponent(path)}`),
};
