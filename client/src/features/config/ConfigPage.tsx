import type { ConfigSection } from "../../app/router";
import { CodegraphPage } from "./CodegraphPage";
import { HooksPage } from "./HooksPage";
import { LibraryPage } from "./LibraryPage";
import { McpPage } from "./McpPage";
import { MemoryPage } from "./MemoryPage";
import { SettingsPage } from "./SettingsPage";

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
