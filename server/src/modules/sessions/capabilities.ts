import { readCodexAgent } from "../../core/codex/agents.js";
import { AGENTS, type Agent } from "../../core/agents.js";
import { HttpError } from "../../core/errors.js";
import { backendOf } from "./backends/index.js";
import { emptyCapability, problem } from "./backends/probe.js";
import type { AgentCapability, BackendProbeContext, CapabilityCheck, PreflightProblem } from "./backends/types.js";

export type { AgentCapability, CapabilityCheck, CapabilityStatus, PreflightErrorCode, PreflightProblem } from "./backends/types.js";

export interface PreflightRequest {
  agent: Agent;
  permissionMode?: string;
  model?: string;
  subagent?: string;
}

export interface PreflightResult {
  /** unknown may proceed with explicit uncertainty; blocked must never mutate a lane. */
  status: "ready" | "unknown" | "blocked";
  configuration: PreflightRequest;
  capability: AgentCapability;
  model: CapabilityCheck;
  errors: PreflightProblem[];
}

/** For engine callers that need a throwable error, while preserving its machine-readable code. */
export class SessionPreflightError extends HttpError {
  readonly code: PreflightProblem["code"];
  constructor(readonly problem: PreflightProblem) {
    super(["unsupported_permission", "unsupported_subagent", "invalid_model", "model_unavailable"].includes(problem.code) ? 400 : 503, problem.message);
    this.code = problem.code;
  }
}

export function requirePreflight(result: PreflightResult): void {
  if (result.errors.length) throw new SessionPreflightError(result.errors[0]);
}

type ContextOf = (request: PreflightRequest) => Promise<BackendProbeContext>;

/** Fresh, context-local probes: no global model/login cache or account data in API responses. */
export async function sessionCapabilities(contextOf: ContextOf): Promise<{ agents: AgentCapability[] }> {
  const agents = await Promise.all(AGENTS.map((agent) => probe({ agent }, contextOf)));
  return { agents };
}

async function probe(request: PreflightRequest, contextOf: ContextOf): Promise<AgentCapability> {
  const backend = backendOf(request.agent);
  try {
    return await backend.probe(await contextOf(request));
  } catch {
    // Context/adapter failure must not take down inventory for the other CLIs.
    const capability = emptyCapability(backend);
    capability.cli.error = problem(request.agent, "probe_failed", "cli");
    return capability;
  }
}

/** Read-only. No session, native thread, hook installation or LLM turn is created. */
export async function preflightSession(request: PreflightRequest, contextOf: ContextOf): Promise<PreflightResult> {
  const backend = backendOf(request.agent);
  const configuration = { ...request };
  if (configuration.model === "default" || configuration.model === "inherit" || configuration.model === "") delete configuration.model;
  const errors: PreflightProblem[] = [];
  if (configuration.permissionMode !== undefined && !backend.permissionModes.includes(configuration.permissionMode))
    errors.push(problem(request.agent, "unsupported_permission", "permissionMode"));
  if (configuration.subagent && !backend.supportsSubagents) errors.push(problem(request.agent, "unsupported_subagent", "subagent"));
  if (request.agent === "codex" && configuration.subagent && backend.supportsSubagents) {
    try {
      readCodexAgent((await contextOf(configuration)).repo, configuration.subagent);
    } catch {
      errors.push(problem(request.agent, "unsupported_subagent", "subagent"));
    }
  }
  if (configuration.model !== undefined && !/^[A-Za-z0-9][\w.:/[\]-]*$/.test(configuration.model)) errors.push(problem(request.agent, "invalid_model", "model"));
  // Reject unsupported permissions before invoking even a read-only CLI.
  const capability = errors.length ? emptyCapability(backend) : await probe(configuration, contextOf);
  let model: CapabilityCheck = { status: "unknown", source: "unverified" };
  if (!errors.length) {
    if (capability.cli.status !== "supported") errors.push(capability.cli.error ?? problem(request.agent, "probe_failed", "cli"));
    if (request.agent === "codex" && capability.cli.status === "supported" && capability.login.status !== "supported")
      errors.push(capability.login.error ?? problem(request.agent, "probe_failed", "login"));
    if (configuration.model) {
      if (capability.models.status === "supported") {
        const offered = capability.models.items.some((item) => item.id === configuration.model || item.model === configuration.model);
        model = { status: offered ? "supported" : "unsupported", source: "model/list", ...(!offered ? { error: problem(request.agent, "model_unavailable", "model") } : {}) };
        if (model.error) errors.push(model.error);
      } else if (request.agent === "codex" && capability.cli.status === "supported") {
        const issue = problem(request.agent, "inventory_unavailable", "model");
        model.error = issue;
        errors.push(issue);
      }
      // PTY legacy model names are retained, with account availability explicitly unknown.
    }
  }
  return {
    status: errors.length ? "blocked" : capability.login.status === "supported" && (!configuration.model || model.status === "supported") ? "ready" : "unknown",
    configuration,
    capability,
    model,
    errors,
  };
}
