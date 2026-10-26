import { useTranslation } from "react-i18next";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { ConfigHeader, ConfigToolbar, LoadError, WorkflowTabs } from "../shared/ConfigChrome";
import { Checks } from "./WorkflowValidation";
import { FileEditor } from "./FileEditor";
import { FileNav } from "./FileNav";
import { FileView } from "./FileView";
import { LegacyBanner } from "./LegacyBanner";
import { PromptPreview } from "./PromptPreview";
import { useWorkflowPage } from "./useWorkflowPage";
import { WorkflowActions } from "./WorkflowActions";
import { ModeBar, OriginBadge, OverrideGuide } from "./WorkflowOrigin";
import "../shared/code-view.css";
import "../shared/library-view.css";
import "./workflow.css";

/**
 * The task workflow: TaskPilot's built-in one is shown read only; "Thêm config override" copies it
 * into the repo's .taskpilot/, where every file can then be edited, checked and previewed.
 */
export function WorkflowPage({ file: initialFile }: { file?: string }) {
  const { t } = useTranslation("config");
  const page = useWorkflowPage(initialFile);
  const { data, error, loading, reload, refresh, isOverride, picked, setPicked, busy, confirm, setConfirm, adding, draft, file, newFiles, flow } = page;

  return (
    <div className="page">
      <ConfigHeader title={t("workflow.title")} subtitle={t("workflow.subtitle")} />
      <WorkflowTabs current="workflow" />
      <ConfigToolbar
        start={data && <OriginBadge config={data} />}
        readOnly={!!data && !isOverride}
        loading={loading}
        onReload={() => void reload()}
        actions={<WorkflowActions page={page} />}
      />
      <LoadError error={error} />
      {data && (
        <div className="page-body wf-page">
          <ModeBar config={data} onPick={page.switchMode} />
          {data.overrideKind === "legacy" && data.mode.id === "custom" && <LegacyBanner config={data} onDone={() => void refresh()} />}
          {!isOverride && (
            <section className="card wf-intro">
              <h2 className="card-title">{t("workflow.defaultTitle", { name: data.mode.name })}</h2>
              <p>{t("workflow.defaultBody", { dir: data.overrideDir })}</p>
              {data.overrideKind !== "none" && <p className="alert-warn">{t("workflow.notApplied", { dir: data.overrideDir, base: data.overrideExtends ?? "custom" })}</p>}
              <ul className="file-list">
                {data.files.map((f) => (
                  <li key={f.name} className="mono">
                    {data.dir}/{f.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {isOverride && confirm === "reset" && <p className="alert-warn">{t("workflow.resetHint", { dir: data.overrideDir })}</p>}
          <OverrideGuide dir={data.overrideDir} open={!isOverride} />
          <Checks config={data} draft={draft} />

          <div className="library">
            <FileNav config={data} picked={picked} newFiles={newFiles} onPick={setPicked} adding={adding && isOverride} onAdd={page.addPrompt} />
            <div className="wf-main">
              {draft ? (
                <FileEditor draft={draft} config={data} />
              ) : file ? (
                <FileView
                  file={file}
                  editable={isOverride}
                  confirmDelete={confirm === "delete"}
                  busy={busy}
                  onDelete={() => (confirm === "delete" ? void page.removeFile() : setConfirm("delete"))}
                  onRestore={() => void page.restoreDefault()}
                />
              ) : null}
              <PromptPreview config={data} />
            </div>
          </div>
        </div>
      )}
      {draft && <DiffDialog {...flow.dialog} confirmLabel={draft.isNew ? t("library.createFile") : t("library.saveFile")} />}
    </div>
  );
}
