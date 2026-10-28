import { useParams, useSearch } from "@tanstack/react-router";
import { CodegraphPage } from "./codegraph-page";
import { isNativeSection, NativeConfigPage } from "./config-page";
import { WorkflowPage } from "./workflow/workflow-page";

/** /config/$section: one page per section. Loaded on first visit, with CodeMirror and the diff view. */
export function ConfigRoute() {
  const { section } = useParams({ from: "/config/$section" });
  const search = useSearch({ from: "/config/$section" });
  if (isNativeSection(section)) return <NativeConfigPage key={`${section}:${search.cli ?? "claude"}`} section={section} search={search} />;
  if (section === "workflow" || section === "formats") return <WorkflowPage section={section} search={search} />;
  return <CodegraphPage />;
}
