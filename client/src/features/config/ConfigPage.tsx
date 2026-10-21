import type { ConfigSection } from "../../shared/router";
import { CodegraphPage } from "./codegraph/CodegraphPage";
import { FormatsPage } from "./formats/FormatsPage";
import { HooksPage } from "./hooks/HooksPage";
import { LibraryPage } from "./library/LibraryPage";
import { McpPage } from "./mcp/McpPage";
import { MemoryPage } from "./memory/MemoryPage";
import { SettingsPage } from "./settings/SettingsPage";
import { WorkflowPage } from "./workflow/WorkflowPage";
// After the pages: the narrow-screen rules override their layouts.
import "./shared/responsive.css";

/** Claude configuration pages (read-only in phase B). */
export function ConfigPage({ section, file }: { section: ConfigSection; file?: string }) {
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
    case "workflow":
      return <WorkflowPage file={file} />;
    case "formats":
      return <FormatsPage />;
    case "mcp":
      return <McpPage />;
    case "codegraph":
      return <CodegraphPage />;
  }
}
