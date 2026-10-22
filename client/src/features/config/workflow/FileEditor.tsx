import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { setDraft } from "../shared/drafts";
import type { WorkflowConfig, WorkflowDraft } from "./types";
import { draftKey, WORKFLOW_FILE } from "./workflow-files";

// CodeMirror and the YAML form are only needed once the user starts editing.
const MarkdownEditor = lazy(() => import("../shared/MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })));
const WorkflowForm = lazy(() => import("./WorkflowForm").then((m) => ({ default: m.WorkflowForm })));

export function FileEditor({ draft, config }: { draft: WorkflowDraft; config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  const [tab, setTab] = useState<"form" | "yaml">(config.overrideKind === "extends" ? "yaml" : "form");
  const insert = useRef<((text: string) => void) | null>(null);
  const update = (content: string) => setDraft(draftKey(draft.name), { ...draft, content });
  const isYml = draft.name === WORKFLOW_FILE;
  const prompts = config.files.map((f) => f.name).filter((n) => n !== WORKFLOW_FILE);
  const outputIds = (config.def?.steps ?? []).flatMap((s) => s.outputs.map((o) => o.id));

  return (
    <section className="card lib-editor wf-editor" aria-label={t("library.editLabel", { path: draft.path })}>
      <header className="lib-head">
        <h2 className="mono">{draft.path}</h2>
        {isYml && config.overrideKind !== "extends" && (
          <div className="segmented" role="tablist" aria-label={t("workflow.editorTabs")}>
            <button type="button" role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>
              {t("workflow.tabForm")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "yaml"} onClick={() => setTab("yaml")}>
              {t("workflow.tabYaml")}
            </button>
          </div>
        )}
      </header>
      {!isYml && (
        <div className="wf-chips" aria-label={t("workflow.variables")}>
          <span className="pane-label">{t("workflow.variables")}</span>
          {[...config.variables, ...outputIds.map((id) => `out.${id}`)].map((v) => (
            <button
              key={v}
              type="button"
              className="wf-chip mono"
              title={t(`workflow.var.${v.startsWith("out.") ? "out" : v}` as "workflow.var.key")}
              onClick={() => insert.current?.(`{{${v}}}`)}
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      )}
      <Suspense fallback={<p className="hint">{t("library.editorLoading")}</p>}>
        {isYml && tab === "form" ? (
          <WorkflowForm text={draft.content} prompts={prompts} onChange={update} />
        ) : (
          <MarkdownEditor key={`${draft.name}-${tab}`} value={draft.content} label={t("library.contentLabel", { path: draft.path })} insertRef={insert} onChange={update} />
        )}
      </Suspense>
    </section>
  );
}
