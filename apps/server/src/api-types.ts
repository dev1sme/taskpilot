/**
 * The types the browser client reads from the HTTP API. The client imports them type-only
 * (`@server/api-types`), so a server change that breaks the UI fails the client's typecheck.
 */
export type { AuthStatus } from "./modules/auth/routes.js";
export type { RepoInfo, ServerInfo } from "./modules/repo/routes.js";
export type { Inventory } from "./modules/repo/inventory.js";
export type { TaskDetail, TaskListItem, TaskStage } from "./modules/tasks/routes.js";
export type { TaskFile, TaskSummary } from "./modules/tasks/scan.js";
export type { ProviderId } from "@taskpilot/shared";
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
export type { ExecutionDefaults, WorkflowModes } from "./modules/config/workflow/routes.js";
export type { ModeInfo } from "./modules/workflow/modes.js";

import type { SessionManager } from "./modules/sessions/manager.js";
/** What each agent CLI can do here: installed, logged in, its models (GET /api/sessions/capabilities). */
export type AgentCapabilities = Awaited<ReturnType<SessionManager["capabilities"]>>;
/** A reviewed handoff: the preview, its preflight and whether a running session must be stopped (POST …/run/handoff/preview). */
export type HandoffPreviewResult = Awaited<ReturnType<WorkflowEngine["previewHandoff"]>>;
export type { ConfigCapabilitiesView } from "./modules/config/routes.js";
export type { ConfigScope, ConfigSection, SectionCapability } from "./modules/config/shared/sections.js";
export type { RawFileView, RawPreview } from "./modules/config/raw/routes.js";
export type { MemoryCheck, MemoryFile, MemoryImport } from "./modules/config/memory/read.js";
export type { HookEntry, NativeSettingsFile, SettingsFile } from "./modules/config/settings/read.js";
export type { CopilotHookEntry, HookFile } from "./modules/config/hooks/hook-files.js";
export type { LibraryItem, LibraryKind } from "./modules/config/library/read.js";
export type { AgentCheck } from "./modules/config/library/check.js";
export type { McpConfig, McpServer } from "./modules/config/mcp/read.js";
export type { MigrationPreview, RenderedPrompt, WorkflowChecks, WorkflowConfigView, WorkflowFileView, WorkflowSavePreview } from "./modules/config/workflow/routes.js";
export type { BackupDiff, BackupView } from "./modules/config/backups/routes.js";
export type { CodegraphStatus, CodegraphSummary } from "./modules/config/codegraph/status.js";
export type { UsageView, UsageWindow } from "./modules/usage/store.js";
