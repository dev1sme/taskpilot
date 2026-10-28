export { isHookEvent, type HookEvent } from "./hooks.js";
export { SessionManager, type SessionView, type SessionCreateOptions, type SessionWaitOptions } from "./manager.js";
export { registerSessionsRoutes } from "./routes.js";
export type { SessionMetrics, SessionMetricsSource } from "./transports/types.js";
export type { SessionFailure, FailureReason } from "./failure.js";
export { providerTraits, type ProviderPromptInventory, type ProviderTraits, type SubagentCheck } from "./backends/index.js";
export { SessionPreflightError, requirePreflight } from "./capabilities.js";
export type { ProviderCapability, CapabilityCheck, CapabilityStatus, PreflightErrorCode, PreflightProblem, PreflightRequest, PreflightResult } from "./capabilities.js";

export type { SessionLauncher, SessionLaunchOptions } from "./backends/types.js";
