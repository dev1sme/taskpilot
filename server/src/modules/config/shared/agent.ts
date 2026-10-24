import { t } from "../../../core/i18n.js";
import { HttpError } from "../../../core/errors.js";

export const CONFIG_CLIS = ["claude", "copilot", "codex"] as const;
export type ConfigCli = (typeof CONFIG_CLIS)[number];
export type ConfigScope = "project" | "local" | "user";
export type ConfigSection = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "mcp";

export interface SectionCapability {
  scopes: ConfigScope[];
  /** Whether the CLI has this native configuration surface. */
  supported: boolean;
  /** Only true once a TaskPilot route and its adapter are ready. */
  available: boolean;
  reason?: string;
}

const feature = (scopes: ConfigScope[], available: boolean): SectionCapability => ({ scopes, supported: true, available });
const unsupported = (reason: string): SectionCapability => ({ scopes: [], supported: false, available: false, reason });

/** Native scope matrix. New CLI surfaces remain unavailable until their adapters are installed. */
export const CONFIG_CAPABILITIES: Record<ConfigCli, Record<ConfigSection, SectionCapability>> = {
  claude: {
    memory: feature(["project", "local", "user"], true),
    settings: feature(["project", "local", "user"], true),
    hooks: feature(["project", "local", "user"], true),
    agents: feature(["project", "user"], true),
    commands: feature(["project", "user"], true),
    skills: feature(["project", "user"], true),
    mcp: feature(["project", "local", "user"], true),
  },
  copilot: {
    memory: feature(["project", "user"], false),
    settings: feature(["project", "local", "user"], false),
    hooks: feature(["project", "user"], false),
    agents: feature(["project", "user"], false),
    commands: unsupported("Copilot CLI has no native commands directory."),
    skills: feature(["project", "user"], false),
    mcp: feature(["project", "user"], false),
  },
  codex: {
    memory: feature(["project", "user"], false),
    settings: feature(["project", "user"], false),
    hooks: unsupported("Codex has no verified native hooks adapter."),
    agents: feature(["project"], false),
    commands: unsupported("Codex has no native commands directory."),
    skills: feature(["project", "user"], false),
    mcp: feature(["project", "user"], false),
  },
};

/** Missing cli keeps every legacy config endpoint on Claude. */
export function configCli(raw?: string): ConfigCli {
  if (raw === undefined || raw === "") return "claude";
  if (CONFIG_CLIS.some((cli) => cli === raw)) return raw as ConfigCli;
  throw new HttpError(400, t("configMessages.shared_agent_01", { value0: raw }));
}

export function requireConfigScope(cli: ConfigCli, section: ConfigSection, scope: ConfigScope): void {
  const capability = CONFIG_CAPABILITIES[cli][section];
  if (!capability.scopes.includes(scope)) throw new HttpError(400, capability.reason ?? t("configMessages.shared_agent_02", { value0: scope, value1: cli, value2: section }));
}

/** Call when a route group has registered and tested the CLI adapter for this section. */
export function markConfigAvailable(cli: ConfigCli, section: ConfigSection): void {
  const capability = CONFIG_CAPABILITIES[cli][section];
  if (!capability.supported) throw new Error(t("configMessages.shared_agent_03", { value0: cli, value1: section }));
  capability.available = true;
}
