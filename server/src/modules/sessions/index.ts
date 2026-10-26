export { isHookEvent, type HookEvent } from "./hooks.js";
export { SessionManager, type SessionView, type SessionCreateOptions, type SessionWaitOptions } from "./manager.js";
export { registerSessionsRoutes } from "./routes.js";
export type { SessionMetrics } from "./transports/types.js";
export type { SessionFailure, FailureReason } from "./failure.js";
export { SessionPreflightError, requirePreflight } from "./capabilities.js";
export type { AgentCapability, CapabilityCheck, CapabilityStatus, PreflightErrorCode, PreflightProblem, PreflightRequest, PreflightResult } from "./capabilities.js";
