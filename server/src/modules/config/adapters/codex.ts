import path from "node:path";
import { t } from "../../../core/i18n.js";
import { codexConfigHome, codexSkillsHome } from "../../../providers/codex/home.js";
import { PLAIN_TOML, SKILL_REL } from "./names.js";
import type { ConfigAdapter } from "./types.js";

const configToml = (repo: string, scope: string) => (scope === "project" ? path.join(repo, ".codex", "config.toml") : path.join(codexConfigHome(), "config.toml"));

export const codexConfig: ConfigAdapter = {
  id: "codex",
  memory: {
    scopes: ["project", "user"],
    file: (repo, scope) => (scope === "project" ? path.join(repo, "AGENTS.md") : path.join(codexConfigHome(), "AGENTS.md")),
  },
  settings: { kind: "native", format: "toml", scopes: ["project", "user"], file: configToml, keys: () => ["approval_policy", "sandbox_mode"] },
  library: {
    agents: {
      scopes: ["project"],
      roots: (repo) => [{ scope: "project", dir: path.join(repo, ".codex", "agents"), editable: true }],
      format: "codex-agent",
      relOk: (_scope, rel) => PLAIN_TOML.test(rel),
      templates: "codex",
    },
    skills: {
      scopes: ["project", "user"],
      roots: (repo) => [
        { scope: "project", dir: path.join(repo, ".agents", "skills"), editable: true },
        { scope: "user", dir: codexSkillsHome(), editable: true },
      ],
      format: "skill",
      relOk: (_scope, rel) => SKILL_REL.test(rel),
      strictNames: true,
    },
  },
  mcp: {
    kind: "native",
    scopes: ["project", "user"],
    format: "toml",
    types: ["stdio", "http"],
    typeError: () => t("configMessages.mcp_edit_01"),
    file: configToml,
    sources: (repo) => [
      { scope: "project", file: configToml(repo, "project") },
      { scope: "user", file: configToml(repo, "user") },
    ],
  },
  homes: () => [
    { dir: codexConfigHome(), rootMayBeSymlink: false },
    { dir: codexSkillsHome(), rootMayBeSymlink: false },
  ],
  unsupported: { hooks: "Codex has no verified native hooks adapter.", commands: "Codex has no native commands directory." },
};
