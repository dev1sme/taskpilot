import path from "node:path";
import { t } from "../../../core/i18n.js";
import { copilotConfigHome } from "../../../providers/copilot/home.js";
import { AGENT_MD, AGENT_OR_MD, SKILL_REL } from "./names.js";
import type { ConfigAdapter } from "./types.js";

const home = (...parts: string[]) => path.join(copilotConfigHome(), ...parts);

export const copilotConfig: ConfigAdapter = {
  id: "copilot",
  memory: {
    scopes: ["project", "user"],
    file: (repo, scope) => (scope === "project" ? path.join(repo, ".github", "copilot-instructions.md") : home("copilot-instructions.md")),
  },
  settings: {
    kind: "native",
    format: "jsonc",
    scopes: ["project", "local", "user"],
    file: (repo, scope) =>
      ({ project: path.join(repo, ".github", "copilot", "settings.json"), local: path.join(repo, ".github", "copilot", "settings.local.json"), user: home("settings.json") })[scope],
    keys: (scope) => ["disableAllHooks", "respectGitignore", ...(scope === "user" ? ["askUser", "permissions.disableBypassPermissionsMode", "sandbox.enabled", "sandbox.allowBypass"] : [])],
  },
  hooks: {
    kind: "files",
    scopes: ["project", "user"],
    dir: (repo, scope) => (scope === "project" ? path.join(repo, ".github", "hooks") : home("hooks")),
    // TaskPilot's own hooks, installed for its sessions.
    reserved: ["taskpilot.json"],
  },
  library: {
    agents: {
      scopes: ["project", "user"],
      // Copilot also loads .claude/agents; shown, but edited as Claude config.
      roots: (repo) => [
        { scope: "project", dir: path.join(repo, ".github", "agents"), editable: true },
        { scope: "project", dir: path.join(repo, ".claude", "agents"), editable: false },
        { scope: "user", dir: home("agents"), editable: true },
      ],
      format: "copilot-agent",
      relOk: (scope, rel) => (scope === "project" ? AGENT_OR_MD : AGENT_MD).test(rel),
    },
    skills: {
      scopes: ["project", "user"],
      roots: (repo) => [
        { scope: "project", dir: path.join(repo, ".github", "skills"), editable: true },
        { scope: "user", dir: home("skills"), editable: true },
      ],
      format: "skill",
      relOk: (_scope, rel) => SKILL_REL.test(rel),
      strictNames: true,
    },
  },
  mcp: {
    kind: "native",
    scopes: ["project", "user"],
    format: "json",
    types: ["stdio", "http", "sse"],
    typeError: () => t("configMessages.mcp_edit_02"),
    file: (repo, scope) => (scope === "project" ? path.join(repo, ".github", "mcp.json") : home("mcp-config.json")),
    // Copilot also reads the repo's .mcp.json; shown, but edited as Claude config.
    sources: (repo) => [
      { scope: "project", file: path.join(repo, ".mcp.json"), readonly: true },
      { scope: "project", file: path.join(repo, ".github", "mcp.json") },
      { scope: "user", file: home("mcp-config.json") },
    ],
  },
  homes: () => [{ dir: copilotConfigHome(), rootMayBeSymlink: false }],
  unsupported: { commands: "Copilot CLI has no native commands directory." },
};
