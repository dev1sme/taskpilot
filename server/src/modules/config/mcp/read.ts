import path from "node:path";
import { claudeJson, displayPath, envRefs, isObject, maskValue, readJsonFile, strings } from "../shared/fs.js";
import { t } from "../../../core/i18n.js";

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
}

export interface McpConfig {
  sources: Array<{ scope: McpScope; path: string; exists: boolean; error?: string }>;
  servers: McpServer[];
}

/**
 * MCP servers Claude sees for this repo: project (.mcp.json, shared), local (~/.claude.json
 * projects[repo], private) and user (~/.claude.json top level). Secret values are masked.
 */
export async function readMcp(repo: string, provided: Record<string, string> = {}): Promise<McpConfig> {
  const projectFile = path.join(repo, ".mcp.json");
  const project = await readJsonFile(projectFile);
  const home = await readJsonFile(claudeJson());

  const sources: McpConfig["sources"] = [
    { scope: "project", path: ".mcp.json", exists: project.exists, ...("error" in project ? { error: project.error } : {}) },
  ];
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

function toServers(value: unknown, scope: McpScope, provided: Record<string, string>): McpServer[] {
  if (!isObject(value)) return [];
  return Object.entries(value).map(([name, raw]) => {
    const cfg = isObject(raw) ? raw : {};
    const command = typeof cfg.command === "string" ? cfg.command : undefined;
    const url = typeof cfg.url === "string" ? cfg.url : undefined;
    const env = isObject(cfg.env) ? Object.entries(cfg.env).map(([key, v]) => ({ key, ...maskValue(v) })) : [];
    const headers = isObject(cfg.headers) ? Object.entries(cfg.headers).map(([key, v]) => ({ key, ...maskValue(v) })) : [];
    const refs = [...env, ...headers].flatMap((e) => (e.reference ? envRefs(e.value) : []));
    const vars = [...new Set([...refs, ...envRefs(url ?? "")])];
    const missingEnv = vars.filter((v) => process.env[v] === undefined && provided[v] === undefined);
    const fromTaskPilot = vars.filter((v) => provided[v] !== undefined);
    // Claude Code reads an entry without `type` as stdio, so a bare `url` entry fails to load.
    const error =
      cfg.type === undefined && !command && url
        ? t("mcp.urlWithoutType")
        : undefined;
    return {
      name,
      scope,
      type: typeof cfg.type === "string" ? cfg.type : url && !command ? "?" : "stdio",
      ...(error ? { error } : {}),
      command,
      args: strings(cfg.args).map(hideUrlCredentials),
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
  return s.replace(/(\w+:\/\/)[^/\s@]+@/g, "$1••••@");
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
  const entry = servers[name];
  return isObject(entry) ? entry : null;
}
