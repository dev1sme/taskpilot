import type { ProviderId } from "../../../core/providers.js";
import type { ConfigScope, ConfigSection } from "../shared/sections.js";
import type { LibraryKind, LibraryScope } from "../library/read.js";
import type { McpType } from "../mcp/edit.js";
import type { AgentTemplateProvider } from "../library/templates.js";

/** The CLI's instruction files (CLAUDE.md, AGENTS.md, copilot-instructions.md). */
export interface MemoryAdapter {
  scopes: ConfigScope[];
  file(repo: string, scope: ConfigScope): string;
  /** A second project file the CLI loads besides `file`; reported, and writable too. */
  alsoLoaded?(repo: string): string | null;
  /** Every project file the CLI may read as memory, for write ownership. */
  projectFiles?(repo: string): string[];
}

/** Claude's settings.json is shown as permissions, env and hooks; the others as a few native fields. */
export type SettingsAdapter = { scopes: ConfigScope[]; file(repo: string, scope: ConfigScope): string } & (
  { kind: "claude" } | { kind: "native"; format: "toml" | "jsonc"; keys(scope: ConfigScope): readonly string[] }
);

/** Claude keeps hooks inside its settings files; Copilot has one JSON file per hook set. */
export type HooksAdapter = { kind: "settings" } | { kind: "files"; scopes: ConfigScope[]; dir(repo: string, scope: ConfigScope): string; reserved: string[] };

/** How the files of one library kind are laid out and read. */
export interface LibraryAdapter {
  scopes: LibraryScope[];
  /** Read in this order; a root that is not editable is shown but never written. */
  roots(repo: string): Array<{ scope: LibraryScope; dir: string; editable: boolean }>;
  format: "markdown" | "skill" | "codex-agent" | "copilot-agent";
  /** Whether `rel` (a "/"-separated path inside the root) names an item of this kind. */
  relOk(scope: LibraryScope, rel: string): boolean;
  /** Writes may reach anything inside an editable root (skills also hold scripts and templates). */
  ownsTree?: boolean;
  /** Skill folders must have simple names. */
  strictNames?: boolean;
  /** TaskPilot's own subagents for this CLI. */
  templates?: AgentTemplateProvider;
  /** Two agents with one name are reported. */
  checkNames?: boolean;
}

/** Claude's MCP servers: .mcp.json, and ~/.claude.json changed only through `claude mcp`. */
export interface ClaudeMcpAdapter {
  kind: "claude";
  scopes: ConfigScope[];
  projectFile(repo: string): string;
}

/** An MCP table inside a native config file. */
export interface NativeMcpAdapter {
  kind: "native";
  scopes: ConfigScope[];
  /** `toml`: `[mcp_servers.<name>]`, type implied by command/url, headers in `http_headers`. `json`: `mcpServers` or a bare map, `local` = stdio. */
  format: "toml" | "json";
  types: readonly McpType[];
  /** The error when a type outside `types` is asked for. */
  typeError: () => string;
  file(repo: string, scope: ConfigScope): string;
  /** Read in this order; the first entry of a name wins. */
  sources(repo: string): Array<{ scope: ConfigScope; file: string; readonly?: boolean }>;
}

export type McpAdapter = ClaudeMcpAdapter | NativeMcpAdapter;

export interface ConfigAdapter {
  id: ProviderId;
  memory: MemoryAdapter;
  settings: SettingsAdapter;
  hooks?: HooksAdapter;
  library: Partial<Record<LibraryKind, LibraryAdapter>>;
  mcp: McpAdapter;
  /**
   * The CLI's home folders TaskPilot writes into. A write must not pass a symlinked folder below
   * one; `rootMayBeSymlink` allows the home itself to be a link (users often link ~/.claude).
   */
  homes(): Array<{ dir: string; rootMayBeSymlink: boolean }>;
  /** Why a section the CLI lacks is unsupported. */
  unsupported: Partial<Record<ConfigSection, string>>;
}
