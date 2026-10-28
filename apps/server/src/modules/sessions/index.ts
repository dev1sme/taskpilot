export { isHookEvent, type HookEvent } from "./hooks.js";
export { SessionManager, type SessionCreateOptions, type SessionWaitOptions } from "./manager.js";
export type { SessionView } from "./types.js";
export { registerSessionsRoutes } from "./routes.js";
export type { SessionMetrics, SessionMetricsSource } from "./transports/types.js";
export type { SessionFailure, FailureReason } from "./types.js";
export { providerTraits, type AccountUsageReport, type ProviderPromptInventory, type ProviderTraits, type SubagentCheck } from "./backends/index.js";
export { SessionPreflightError, requirePreflight } from "./preflight.js";
export type { ProviderCapability, CapabilityCheck, CapabilityStatus, PreflightErrorCode, PreflightProblem, PreflightRequest, PreflightResult } from "./preflight.js";

export type { SessionLauncher, SessionLaunchOptions } from "./backends/types.js";
export { sessionEventFromHook, type SessionEvent } from "./events.js";
