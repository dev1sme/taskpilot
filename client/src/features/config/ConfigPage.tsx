import { Fragment } from "react";
import type { ConfigSection } from "../../shared/router";
import { useWorkspace } from "../workspace";
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
  const { repo } = useWorkspace();
  // Keyed by repo: switching repo mounts the page afresh, so nothing picked or half-filled for the old
  // repo (an open form, a selected item) carries over. Drafts are kept per repo in `drafts.ts`.
  // Nothing is shown before the repo is known, or its arrival would mount the page a second time.
  if (!repo) return null;
  return (
    <Fragment key={repo.path ?? ""}>
      <Section section={section} file={file} />
    </Fragment>
  );
}

function Section({ section, file }: { section: ConfigSection; file?: string }) {
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
