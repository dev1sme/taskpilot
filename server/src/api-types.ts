/**
 * The types the browser client reads from the HTTP API. The client imports them type-only
 * (`@server/api-types`), so a server change that breaks the UI fails the client's typecheck.
 */
export type { AuthStatus } from "./modules/auth/routes.js";
export type { RepoInfo, ServerInfo } from "./modules/repo/routes.js";
export type { Inventory } from "./modules/repo/inventory.js";
export type { TaskDetail, TaskListItem, TaskStage } from "./modules/tasks/routes.js";
export type { TaskFile, TaskSummary } from "./modules/tasks/scan.js";
export type { ProviderId } from "./core/providers.js";
