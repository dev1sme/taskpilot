import type { ParseKeys } from "i18next";
import type { ProviderId } from "../../../shared/providers";
import { shadowedBy } from "./precedence";
import type { McpServer } from "../mcp/types";

interface ConfigAdapter {
  settingsEditor: "claude" | "native";
  hooksEditor: "claude" | "copilot" | "unsupported";
  memory: { title: ParseKeys<"config">; subtitle: ParseKeys<"config">; loads: ParseKeys<"config"> };
  mcp: {
    prefix: "mcp" | "mcp.cli.copilot" | "mcp.cli.codex";
    check: boolean;
    editableSource: (path: string) => boolean;
    hiddenBy: (server: McpServer, all: McpServer[]) => string | null;
  };
  libraryPrecedence: boolean;
}
const nativeHidden = (server: McpServer, all: McpServer[]) => server.effective === false ? (all.find((s) => s.name === server.name && s.effective)?.source ?? null) : null;

/** Presentation and native policies only. Availability and scopes belong to the server. */
export const configAdapters: Record<ProviderId, ConfigAdapter> = {
  claude: {
    settingsEditor: "claude", hooksEditor: "claude", libraryPrecedence: true,
    memory: { title: "memory.title", subtitle: "memory.subtitle", loads: "memory.loads" },
    mcp: { prefix: "mcp", check: true, editableSource: () => true, hiddenBy: (s, all) => shadowedBy("mcp", s, all) },
  },
  copilot: {
    settingsEditor: "native", hooksEditor: "copilot", libraryPrecedence: false,
    memory: { title: "memory.cli.copilot.title", subtitle: "memory.cli.copilot.subtitle", loads: "memory.loadsEstimate" },
    mcp: { prefix: "mcp.cli.copilot", check: false, editableSource: (path) => path !== ".mcp.json", hiddenBy: nativeHidden },
  },
  codex: {
    settingsEditor: "native", hooksEditor: "unsupported", libraryPrecedence: false,
    memory: { title: "memory.cli.codex.title", subtitle: "memory.cli.codex.subtitle", loads: "memory.loadsEstimate" },
    mcp: { prefix: "mcp.cli.codex", check: false, editableSource: () => true, hiddenBy: nativeHidden },
  },
};
