import { ArrowCounterClockwise, CheckCircle, Eye, FilePlus, PencilSimple, Plus } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DraftControls } from "../shared/ScopeControls";
import type { WorkflowPageState } from "./useWorkflowPage";
import { draftKey } from "./workflow-files";

/** Toolbar buttons: built-in workflow, override being read, override being edited. */
export function WorkflowActions({ page }: { page: WorkflowPageState }) {
  const { t } = useTranslation("config");
  const { data, isOverride, draft, picked, file, busy, confirm, flow } = page;
  if (!data) return null;

  const canCreate = data.overrideKind === "none";
  if (!isOverride) {
    return (
      <>
        {data.mode.id !== data.selected && (
          <Button icon={CheckCircle} variant="quiet" busy={busy} onClick={() => void page.setDefaultMode()}>
            {t("workflow.modes.setDefault")}
          </Button>
        )}
        {canCreate && (
          <Button icon={Plus} variant="primary" busy={busy} title={t("workflow.createTitle", { dir: data.overrideDir, mode: data.mode.id })} onClick={() => void page.createOverride()}>
            {t("workflow.create", { name: data.mode.name })}
          </Button>
        )}
      </>
    );
  }
  if (draft) {
    return (
      <>
        <DraftControls key={picked} draftKey={draftKey(picked)} />
        <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
          {t("action.review")}
        </Button>
      </>
    );
  }
  return (
    <>
      {data.mode.id !== data.selected && (
        <Button icon={CheckCircle} variant="quiet" busy={busy} onClick={() => void page.setDefaultMode()}>
          {t("workflow.modes.setDefault")}
        </Button>
      )}{" "}
      <Button icon={FilePlus} variant="quiet" onClick={() => page.setAdding((a) => !a)}>
        {t("workflow.addPrompt")}
      </Button>
      {confirm === "reset" ? (
        <Button icon={ArrowCounterClockwise} variant="danger" busy={busy} onClick={() => void page.reset()}>
          {t("workflow.resetConfirm")}
        </Button>
      ) : (
        <Button icon={ArrowCounterClockwise} variant="quiet" title={t("workflow.resetTitle", { dir: data.overrideDir })} onClick={() => page.setConfirm("reset")}>
          {t("workflow.reset")}
        </Button>
      )}
      {file && (
        <Button icon={PencilSimple} variant="primary" busy={busy} title={t("library.editTitle", { path: file.path })} onClick={() => void page.startEdit()}>
          {t("action.edit")}
        </Button>
      )}
    </>
  );
}
