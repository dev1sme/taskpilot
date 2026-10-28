import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId } from "../../shared/providers";
import { isCliConfigSection, type ConfigSection } from "../../shared/router";
import { call } from "../../shared/api/http";
import { useWorkspace } from "../workspace";
import { CodegraphPage } from "./codegraph/CodegraphPage";
import { FormatsPage } from "./formats/FormatsPage";
import { HooksPage } from "./hooks/HooksPage";
import { LibraryPage } from "./library/LibraryPage";
import { McpPage } from "./mcp/McpPage";
import { MemoryPage } from "./memory/MemoryPage";
import { SettingsPage } from "./settings/SettingsPage";
import { CapabilityNotice, CliSelector, ConfigCapabilitiesContext, ConfigCliContext, type SectionCapability } from "./shared/CliContext";
import { ConfigHeader } from "./shared/ConfigChrome";
import { useConfig } from "./shared/useConfig";
import { WorkflowPage } from "./workflow/WorkflowPage";
// After the pages: the narrow-screen rules override their layouts.
import "./shared/responsive.css";

interface CapabilitiesResponse {
  cli: ProviderId;
  sections: Partial<Record<ConfigSection, SectionCapability>>;
}

/** Native CLI configuration and TaskPilot's shared pages. */
export function ConfigPage({ section, file, cli = "claude" }: { section: ConfigSection; file?: string; cli?: ProviderId }) {
  const { repo } = useWorkspace();
  // Keyed by repo: switching repo mounts the page afresh, so nothing picked or half-filled for the old
  // repo (an open form, a selected item) carries over. Drafts are kept per repo in `drafts.ts`.
  // Nothing is shown before the repo is known, or its arrival would mount the page a second time.
  if (!repo) return null;
  return <Fragment key={repo.path ?? ""}>{isCliConfigSection(section) ? <NativeSection key={`${cli}:${section}`} section={section} cli={cli} /> : <Section section={section} file={file} />}</Fragment>;
}

function NativeSection({ section, cli }: { section: ConfigSection; cli: ProviderId }) {
  const { t } = useTranslation("shell");
  const { data, error, loading } = useConfig(["config-capabilities", cli], () => call<CapabilitiesResponse>("GET", `/api/config/capabilities?cli=${cli}`));
  const capability = data?.sections[section] ?? null;
  return (
    <ConfigCliContext.Provider value={cli}>
      <CliSelector cli={cli} section={section} />
      {!loading && !error && data?.cli === cli && capability?.supported && capability.available && capability.scopes.length > 0 ? (
        <ConfigCapabilitiesContext.Provider value={{ section, sections: data.sections }}>
          <Section key={capability.scopes.join(":")} section={section} />
        </ConfigCapabilitiesContext.Provider>
      ) : (
        <div className="page">
          <ConfigHeader title={t(`nav.${section === "agents" || section === "commands" || section === "skills" ? "library" : section}`)} />
          <CapabilityNotice cli={cli} capability={capability} loading={loading} error={error} />
        </div>
      )}
    </ConfigCliContext.Provider>
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
