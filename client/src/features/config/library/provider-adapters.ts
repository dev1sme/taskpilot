import type { ParseKeys } from "i18next";
import i18n from "../../../i18n";
import type { ProviderId } from "../../../shared/providers";
import type { LibraryItem, LibraryKind } from "./types";

type LibraryScope = LibraryItem["scope"];
interface LibraryAdapter {
  directory: (kind: LibraryKind, scope: LibraryScope) => string;
  template: (kind: LibraryKind, name: string) => string;
  relativePath: (kind: LibraryKind, name: string) => string;
  copyKey: (kind: LibraryKind, field: "subtitle" | "empty") => ParseKeys<"config">;
  templates: boolean;
  templatesTitle: ParseKeys<"config">;
}
const templateCopy = () => i18n.getFixedT(null, "config", "library.template");

/** Shared Markdown formats; agent frontmatter / TOML stays native. */
function templateWith(agent: (name: string) => string): LibraryAdapter["template"] {
  return (kind, name) => {
    const base = name.split("/").pop() ?? name;
    const t = templateCopy();
    if (kind === "agents") return agent(base);
    if (kind === "commands") return `---\ndescription: ${t("commandDescription")}\nargument-hint: ${t("commandArgumentHint")}\n---\n\n${t("commandBody")}\n`;
    return `---\nname: ${base}\ndescription: ${t("skillDescription")}\n---\n\n# ${base}\n\n${t("skillBody")}\n`;
  };
}
const relativePath = (extension: string): LibraryAdapter["relativePath"] => (kind, name) => kind === "skills" ? `${name}/SKILL.md` : `${name}${extension}`;
const nativeCopy = (prefix: "library.cli.copilot" | "library.cli.codex"): LibraryAdapter["copyKey"] => (kind, field) => kind === "commands" ? `library.kind.commands.${field}` : `${prefix}.${kind}.${field}`;

/** No availability/scope matrix here: those values are supplied by the server. */
export const libraryAdapters: Record<ProviderId, LibraryAdapter> = {
  claude: {
    directory: (kind, scope) => scope === "project" ? `.claude/${kind}` : `~/.claude/${kind}`,
    relativePath: relativePath(".md"),
    template: templateWith((name) => {
      const t = templateCopy();
      return `---\nname: ${name}\ndescription: ${t("agentDescription")}\ntools: Read, Grep, Glob\nmodel: sonnet\n---\n\n${t("agentBody", { name })}\n`;
    }),
    copyKey: (kind, field) => `library.kind.${kind}.${field}`,
    templates: true,
    templatesTitle: "library.templates.buttonTitle",
  },
  copilot: {
    directory: (kind, scope) => scope === "project" ? `.github/${kind === "agents" ? "agents" : "skills"}` : `~/.copilot/${kind === "agents" ? "agents" : "skills"}`,
    relativePath: relativePath(".agent.md"),
    template: templateWith((name) => {
      const t = templateCopy();
      return `---\ndescription: ${t("agentDescription")}\n---\n\n${t("agentBody", { name })}\n`;
    }),
    copyKey: nativeCopy("library.cli.copilot"),
    templates: false,
    templatesTitle: "library.templates.buttonTitle",
  },
  codex: {
    directory: (kind, scope) => kind === "agents" ? ".codex/agents" : scope === "project" ? ".agents/skills" : "~/.agents/skills",
    relativePath: relativePath(".toml"),
    template: templateWith((name) => {
      const t = templateCopy();
      return `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(t("agentDescription"))}\ndeveloper_instructions = ${JSON.stringify(t("agentBody", { name }))}\n`;
    }),
    copyKey: nativeCopy("library.cli.codex"),
    templates: true,
    templatesTitle: "library.templates.codex.buttonTitle",
  },
};

/** Prefer the writable native source returned by the server; inherited sources keep their own identity. */
export function sourceDirectory(items: LibraryItem[], scope: LibraryScope): string | undefined {
  const item = items.find((i) => i.scope === scope && i.editable !== false && i.path.endsWith(i.rel));
  return item ? item.path.slice(0, -item.rel.length).replace(/\/$/, "") : undefined;
}
