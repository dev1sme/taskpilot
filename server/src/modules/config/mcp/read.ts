import { claudeJson } from "../../../providers/claude/home.js";
import { displayPath, envRefs, maskValue, readJsonFile, strings } from "../shared/fs.js";
import { t } from "../../../core/i18n.js";
import { parse as parseToml } from "smol-toml";
import { readText } from "../shared/fs.js";
import { type ProviderId } from "../../../core/providers.js";
import { HttpError } from "../../../core/errors.js";
import { configAdapter, type NativeMcpAdapter } from "../adapters/index.js";
import { isObject } from "../../../core/values.js";

export type McpScope = "project" | "local" | "user";

export interface McpServer {
  name: string;
  scope: McpScope;
  type: string;
  command?: string;
  args: string[];
  url?: string;
  env: Array<{ key: string; value: string; reference: boolean }>;
  headers: Array<{ key: string; value: string; reference: boolean }>;
  /** ${VAR} references set neither in TaskPilot's environment nor in its env store. */
  missingEnv: string[];
  /** ${VAR} references TaskPilot provides to its sessions from its env store. */
  fromTaskPilot: string[];
  /** Why Claude Code skips this entry, e.g. a `url` without a `type`. */
  error?: string;
  source?: string;
  editable?: boolean;
  effective?: boolean;
}

export interface McpConfig {
  sources: Array<{ scope: McpScope; path: string; exists: boolean; error?: string }>;
  servers: McpServer[];
}

/**
 * MCP servers Claude sees for this repo: project (.mcp.json, shared), local (~/.claude.json
 * projects[repo], private) and user (~/.claude.json top level). Secret values are masked.
 */
export async function readMcp(repo: string, provided: Record<string, string> = {}, cli: ProviderId = "claude"): Promise<McpConfig> {
  const mcp = configAdapter(cli).mcp;
  if (mcp.kind === "native") return readNativeMcp(repo, provided, cli, mcp);
  const projectFile = mcp.projectFile(repo);
  const project = await readJsonFile(projectFile);
  const home = await readJsonFile(claudeJson());

  const sources: McpConfig["sources"] = [{ scope: "project", path: displayPath(projectFile, repo), exists: project.exists, ...("error" in project ? { error: project.error } : {}) }];
  const servers: McpServer[] = [];
  if ("data" in project && isObject(project.data)) servers.push(...toServers(project.data.mcpServers, "project", provided));

  const homeData = "data" in home && isObject(home.data) ? home.data : null;
  const projects = homeData && isObject(homeData.projects) ? homeData.projects : null;
  const local = projects && isObject(projects[repo]) ? projects[repo] : null;
  sources.push(
    { scope: "local", path: `${displayPath(claudeJson(), repo)} › projects`, exists: Boolean(local?.mcpServers) },
    { scope: "user", path: displayPath(claudeJson(), repo), exists: Boolean(homeData?.mcpServers), ...("error" in home ? { error: home.error } : {}) },
  );
  if (local) servers.push(...toServers(local.mcpServers, "local", provided));
  if (homeData) servers.push(...toServers(homeData.mcpServers, "user", provided));
  return { sources, servers };
}

/** The CLI's MCP adapter, which must keep its servers in a native file. */
export function nativeMcp(cli: ProviderId): NativeMcpAdapter {
  const mcp = configAdapter(cli).mcp;
  if (mcp.kind !== "native") throw new Error(`${cli} keeps no native MCP file`);
  return mcp;
}

export function nativeMcpDocument(text: string | null, cli: ProviderId): Record<string, unknown> {
  if (text === null || !text.trim()) return {};
  try {
    const data: unknown = nativeMcp(cli).format === "toml" ? parseToml(text) : JSON.parse(text);
    if (!isObject(data)) throw new Error("root");
    return data;
  } catch {
    throw new HttpError(409, t("configMessages.mcp_read_01", { value0: cli }));
  }
}

export function nativeMcpServers(doc: Record<string, unknown>, cli: ProviderId): Record<string, unknown> {
  const json = nativeMcp(cli).format === "json";
  const value = json ? doc.mcpServers : doc.mcp_servers;
  // A JSON file may be the bare map of servers.
  if (json && value === undefined && Object.values(doc).every(isObject)) return doc;
  if (value === undefined) return {};
  if (!isObject(value)) throw new HttpError(409, t("configMessages.mcp_read_02", { value0: cli }));
  return value;
}

/** A TOML entry implies its type (command = stdio) and keeps headers in `http_headers`; seen in the form's shape. */
export function formEntry(mcp: NativeMcpAdapter, entry: Record<string, unknown>): Record<string, unknown> {
  return mcp.format === "toml" ? { ...entry, type: entry.command ? "stdio" : "http", headers: entry.http_headers } : entry;
}

async function readNativeMcp(repo: string, provided: Record<string, string>, cli: ProviderId, mcp: NativeMcpAdapter): Promise<McpConfig> {
  const locations = mcp.sources(repo);
  const sources: McpConfig["sources"] = [];
  const servers: McpServer[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    const text = await readText(location.file);
    const source = { scope: location.scope, path: displayPath(location.file, repo), exists: text !== null };
    sources.push(source);
    if (text === null) continue;
    try {
      const entries = nativeMcpServers(nativeMcpDocument(text, cli), cli);
      const normalized = Object.fromEntries(Object.entries(entries).map(([name, raw]) => [name, isObject(raw) ? formEntry(mcp, raw) : raw]));
      servers.push(
        ...toServers(normalized, location.scope, provided).map((server) => {
          const effective = !seen.has(server.name);
          seen.add(server.name);
          return { ...server, type: server.type === "local" ? "stdio" : server.type, source: source.path, editable: !location.readonly, effective };
        }),
      );
    } catch {
      Object.assign(source, { error: t("configMessages.mcp_read_03", { value0: cli }) });
    }
  }
  return { sources, servers };
}

function toServers(value: unknown, scope: McpScope, provided: Record<string, string>): McpServer[] {
  if (!isObject(value)) return [];
  return Object.entries(value).map(([name, raw]) => {
    const cfg = isObject(raw) ? raw : {};
    const command = typeof cfg.command === "string" ? maskMcpCommand(cfg.command) : undefined;
    const url = typeof cfg.url === "string" ? cfg.url : undefined;
    const env = isObject(cfg.env) ? Object.entries(cfg.env).map(([key, v]) => ({ key, ...maskValue(v) })) : [];
    const headers = isObject(cfg.headers) ? Object.entries(cfg.headers).map(([key, v]) => ({ key, ...maskValue(v) })) : [];
    const refs = [...env, ...headers].flatMap((e) => (e.reference ? envRefs(e.value) : []));
    const vars = [...new Set([...refs, ...envRefs(url ?? "")])];
    const missingEnv = vars.filter((v) => process.env[v] === undefined && provided[v] === undefined);
    const fromTaskPilot = vars.filter((v) => provided[v] !== undefined);
    // Claude Code reads an entry without `type` as stdio, so a bare `url` entry fails to load.
    const error = cfg.type === undefined && !command && url ? t("mcp.urlWithoutType") : undefined;
    return {
      name,
      scope,
      type: typeof cfg.type === "string" ? cfg.type : url && !command ? "?" : "stdio",
      ...(error ? { error } : {}),
      command,
      args: strings(cfg.args).map(maskMcpArg),
      url: url && hideUrlCredentials(url),
      env,
      headers,
      missingEnv,
      fromTaskPilot,
    };
  });
}

/** "postgresql://user:secret@host/db" → "postgresql://••••@host/db". */
export function hideUrlCredentials(s: string): string {
  return s.replace(/(\w+:\/\/)[^/\s@]+@/g, "$1••••@").replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1?••••");
}

export function maskMcpArg(value: string): string {
  if (/^\w+:\/\/\S+$/.test(value)) return hideUrlCredentials(value);
  if (/^(?:-[A-Za-z]|--[A-Za-z][\w-]*|@[A-Za-z0-9_./-]+)$/.test(value)) return value;
  return "••••";
}

export function maskMcpCommand(value: string): string {
  return /^[A-Za-z0-9_./\\-]+$/.test(value) ? value : "••••";
}

/** A local- or user-scope server entry from ~/.claude.json, or null. */
export async function claudeJsonEntry(scope: "local" | "user", repo: string, name: string): Promise<Record<string, unknown> | null> {
  const home = await readJsonFile(claudeJson());
  const data = "data" in home && isObject(home.data) ? home.data : {};
  let holder: unknown = data;
  if (scope === "local") {
    const projects = isObject(data.projects) ? data.projects : {};
    holder = projects[repo];
  }
  const servers = isObject(holder) && isObject(holder.mcpServers) ? holder.mcpServers : {};
  const entry = Object.hasOwn(servers, name) ? servers[name] : null;
  return isObject(entry) ? entry : null;
}
