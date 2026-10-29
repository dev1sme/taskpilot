/**
 * The types the web client reads from the HTTP API: the contract between server and web. The web
 * imports them type-only (`@taskpilot/server/api-types`), so a server change that breaks the UI
 * fails the web's typecheck.
 *
 * Each module keeps its API types in its own `types.ts`; this file only lists them. The few types
 * below that are derived from code (ReturnType of a method or function) stay next to that code.
 */
export type { ProviderId } from "@taskpilot/shared";
export type { ObservationState, ObservationReason, ObservationAvailability, SessionObservation } from "./core/observation-types.js";
export type { UsageWindow } from "./core/usage-types.js";
export type { AuthStatus } from "./modules/auth/types.js";
export type { Inventory, RepoInfo, ServerInfo } from "./modules/repo/types.js";
export type { TaskDetail, TaskFile, TaskListItem, TaskStage, TaskStatus, TaskSummary } from "./modules/tasks/types.js";
export type * from "./modules/workflow/types.js";
export type { SessionFailure, SessionStatus, SessionView } from "./modules/sessions/types.js";
export type { ActivityItem, ActivityKind } from "./modules/activity/types.js";
export type { UsageView } from "./modules/usage/types.js";
export type { ConfigCapabilitiesView } from "./modules/config/types.js";
export type { ConfigScope, ConfigSection, SectionCapability } from "./modules/config/shared/sections.js";
export type { RawFileView, RawPreview } from "./modules/config/raw/types.js";
export type { MemoryCheck, MemoryFile, MemoryImport } from "./modules/config/memory/types.js";
export type { HookEntry, NativeSettingsFile, SettingsFile } from "./modules/config/settings/types.js";
export type { CopilotHookEntry, HookFile } from "./modules/config/hooks/types.js";
export type { AgentCheck, LibraryItem, LibraryKind } from "./modules/config/library/types.js";
export type { McpConfig, McpServer } from "./modules/config/mcp/types.js";
export type { ExecutionDefaults, MigrationPreview, RenderedPrompt, WorkflowChecks, WorkflowFileView, WorkflowModes, WorkflowSavePreview } from "./modules/config/workflow/types.js";
export type { BackupDiff, BackupView } from "./modules/config/backups/types.js";
export type { CodegraphStatus, CodegraphSummary } from "./modules/config/codegraph/types.js";

// Derived from code.
import type { SessionManager } from "./modules/sessions/manager.js";
import type { WorkflowEngine } from "./modules/workflow/engine.js";
/** What a new run would get: workflow, execution and preflight checks (POST /api/tasks/:key/run/preview). */
export type RunPreview = Awaited<ReturnType<WorkflowEngine["preview"]>>;
/** A reviewed handoff: the preview, its preflight and whether a running session must be stopped (POST …/run/handoff/preview). */
export type HandoffPreviewResult = Awaited<ReturnType<WorkflowEngine["previewHandoff"]>>;
/** What each agent CLI can do here: installed, logged in, its models (GET /api/sessions/capabilities). */
export type AgentCapabilities = Awaited<ReturnType<SessionManager["capabilities"]>>;
export type { WorkflowConfigView } from "./modules/config/workflow/routes.js";
