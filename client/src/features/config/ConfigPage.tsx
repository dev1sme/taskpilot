import type { ConfigSection } from "../../shared/router";
import { CodegraphPage } from "./codegraph/CodegraphPage";
import { HooksPage } from "./hooks/HooksPage";
import { LibraryPage } from "./library/LibraryPage";
import { McpPage } from "./mcp/McpPage";
import { MemoryPage } from "./memory/MemoryPage";
import { SettingsPage } from "./settings/SettingsPage";

/** Claude configuration pages (read-only in phase B). */
export function ConfigPage({ section }: { section: ConfigSection }) {
  switch (section) {
    case "memory":
      return <MemoryPage />;
    case "settings":
      return <SettingsPage />;
    case "hooks":
      return <HooksPage />;
    case "agents":
    case "commands":
    case "skills":
      return <LibraryPage kind={section} />;
    case "mcp":
      return <McpPage />;
    case "codegraph":
      return <CodegraphPage />;
  }
}
