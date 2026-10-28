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
export type * from "./modules/workflow/types.js";
export type { RunView } from "./modules/workflow/run-view.js";
export type { Question } from "./modules/workflow/questions.js";
export type { ParsedAssignments } from "./modules/workflow/assignments.js";
export type { HandoffCommitRequest, HandoffPreview, HandoffRequest } from "./modules/workflow/handoff.js";
export type { SessionFailure, SessionView } from "./modules/sessions/index.js";
export type { ActivityItem } from "./modules/activity/store.js";

import type { WorkflowEngine } from "./modules/workflow/engine.js";
/** What a new run would get: workflow, execution and preflight checks (POST /api/tasks/:key/run/preview). */
export type RunPreview = Awaited<ReturnType<WorkflowEngine["preview"]>>;
