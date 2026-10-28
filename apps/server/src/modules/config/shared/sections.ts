import { t } from "../../../core/i18n.js";
import { HttpError } from "../../../core/errors.js";
import { PROVIDER_IDS, type ProviderId } from "@taskpilot/shared";
import { configAdapter, sectionScopes } from "../adapters/index.js";

export type ConfigScope = "project" | "local" | "user";
export type ConfigSection = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "mcp";

export const CONFIG_SECTIONS: readonly ConfigSection[] = ["memory", "settings", "hooks", "agents", "commands", "skills", "mcp"];

export interface SectionCapability {
  scopes: ConfigScope[];
  /** Whether the CLI has this native configuration surface. */
  supported: boolean;
  /** Whether TaskPilot can show and edit it; every supported section has an adapter. */
  available: boolean;
  reason?: string;
}

/** What each section of a CLI's configuration supports, from its adapter. */
export function configCapability(cli: ProviderId, section: ConfigSection): SectionCapability {
  const adapter = configAdapter(cli);
  const scopes = sectionScopes(adapter, section);
  if (scopes) return { scopes, supported: true, available: true };
  return { scopes: [], supported: false, available: false, reason: adapter.unsupported[section] ?? t("configMessages.routes_02", { value0: section, value1: cli }) };
}

export function configCapabilities(cli: ProviderId): Record<ConfigSection, SectionCapability> {
  return Object.fromEntries(CONFIG_SECTIONS.map((section) => [section, configCapability(cli, section)])) as Record<ConfigSection, SectionCapability>;
}

/** Missing cli is Claude: the config endpoints predate the other CLIs. */
export function parseConfigProvider(raw?: string): ProviderId {
  if (raw === undefined || raw === "") return "claude";
  if (PROVIDER_IDS.some((cli) => cli === raw)) return raw as ProviderId;
  throw new HttpError(400, t("configMessages.shared_agent_01", { value0: raw }));
}

export function requireConfigScope(cli: ProviderId, section: ConfigSection, scope: ConfigScope): void {
  const capability = configCapability(cli, section);
  if (!capability.scopes.includes(scope)) throw new HttpError(400, capability.reason ?? t("configMessages.shared_agent_02", { value0: scope, value1: cli, value2: section }));
}
