import { parse as parseToml } from "smol-toml";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import { type ProviderId } from "@taskpilot/shared";
import { isObject } from "../../../core/values.js";
import { configAdapter } from "../adapters/index.js";
import { readCopilotHooks } from "../hooks/hook-files.js";
import { checkCodexAgent } from "../library/check.js";
import { nativeMcpDocument } from "../mcp/read.js";
import { nativeSettingsOf, readNativeFields } from "../settings/native.js";
import { CONFIG_SECTIONS, type ConfigScope, type ConfigSection } from "../shared/sections.js";
import { hookTarget, libraryTarget, mcpTarget, memoryTarget, settingsTarget, type FileTarget } from "../shared/targets.js";

/** How a raw file is checked before it is written. */
export type RawFormat = "markdown" | "json" | "jsonc" | "toml";

/** One native config file, addressed the way the UI shows it: CLI, section, scope and, for items, a name. */
export interface RawFile {
  target: FileTarget;
  format: RawFormat;
  /** Library items are files of their own and may be deleted; the other files are only edited. */
  deletable: boolean;
  validate(content: string): void;
}

export interface RawAddress {
  cli: ProviderId;
  section: string;
  scope: ConfigScope;
  name?: string;
}

const invalid = (target: FileTarget, format: RawFormat, error: unknown) =>
  new HttpError(400, t("raw.invalid", { file: target.display, format, error: error instanceof Error ? error.message : String(error) }));

function parsesTo(format: "json" | "toml", content: string): void {
  const data: unknown = format === "toml" ? parseToml(content) : JSON.parse(content);
  if (!isObject(data)) throw new Error(t("raw.notObject"));
}

/** The file behind a section of a CLI's configuration, and the check its content must pass. */
export function rawFile(repo: string, { cli, section, scope, name }: RawAddress): RawFile {
  if (!(CONFIG_SECTIONS as readonly string[]).includes(section)) throw new HttpError(400, t("errors.invalidKind", { kind: section }));
  const adapter = configAdapter(cli);
  const file = (target: FileTarget, format: RawFormat, check: (content: string) => void = () => {}, deletable = false): RawFile => ({
    target,
    format,
    deletable,
    validate: (content) => {
      if (content.trim() === "" && format !== "markdown") return;
      try {
        check(content);
      } catch (error) {
        // A file the CLI could not read is a bad request here, whatever the reader calls it.
        throw error instanceof HttpError && error.status === 400 ? error : invalid(target, format, error);
      }
    },
  });
  switch (section as ConfigSection) {
    case "memory":
      return file(memoryTarget(repo, scope, cli), "markdown");
    case "settings": {
      const native = nativeSettingsOf(cli);
      const target = settingsTarget(repo, scope, cli);
      if (!native) return file(target, "json", (c) => parsesTo("json", c));
      return file(target, native.format, (c) => readNativeFields(native, scope, c));
    }
    case "hooks": {
      const hooks = adapter.hooks;
      // Claude's hooks are a key of its settings files.
      if (hooks?.kind === "settings") return rawFile(repo, { cli, section: "settings", scope });
      if (!name) throw new HttpError(400, t("errors.missing", { key: "name" }));
      if (hooks?.kind === "files" && hooks.reserved.includes(name)) throw new HttpError(403, t("configMessages.hooks_routes_01"));
      return file(hookTarget(repo, scope, name, cli), "json", (c) => readCopilotHooks(c));
    }
    case "mcp": {
      const mcp = adapter.mcp;
      const target = mcpTarget(repo, scope, cli);
      if (mcp.kind === "claude") return file(target, "json", (c) => parsesTo("json", c));
      return file(target, mcp.format, (c) => nativeMcpDocument(c, cli));
    }
    default: {
      const kind = section as "agents" | "commands" | "skills";
      if (scope === "local") throw new HttpError(400, t("errors.invalidScope", { scope }));
      if (!name) throw new HttpError(400, t("errors.missing", { key: "name" }));
      const target = libraryTarget(repo, kind, scope, name, cli);
      if (adapter.library[kind]?.format === "codex-agent")
        return file(
          target,
          "toml",
          (c) => {
            parsesTo("toml", c);
            if (checkCodexAgent(c).status === "error") throw new HttpError(400, t("configMessages.library_routes_01"));
          },
          true,
        );
      return file(target, "markdown", () => {}, true);
    }
  }
}
