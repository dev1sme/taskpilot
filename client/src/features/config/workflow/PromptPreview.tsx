import { Play } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { getDraft, useDrafts } from "../shared/drafts";
import { workflowConfigApi } from "./api";
import type { WorkflowConfig, WorkflowDraft } from "./types";
import { draftKey, openDraftNames } from "./workflow-files";

/**
 * The prompt a step would send, rendered by the server for a sample task from the workflow plus open
 * drafts. A real task's prompts are on its own screen ("Prompt đã gửi"): a task that already ran
 * got the prompt of the workflow it started with, which this page cannot show.
 */
export function PromptPreview({ config }: { config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  const steps = config.def?.steps ?? [];
  const [stepId, setStepId] = useState("");
  const [kind, setKind] = useState<"prompt" | "onReject">("prompt");
  const [restart, setRestart] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<{ task: { key: string; title: string }; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDrafts();

  const step = steps.find((s) => s.id === stepId) ?? steps[0];
  const dispatch = !!step?.dispatch;
  const onReject = !dispatch && kind === "onReject" && !!step?.onRejectFile;

  const show = async () => {
    setError(null);
    const drafts: Record<string, string> = {};
    if (config.origin === "repo") {
      for (const name of [...config.files.map((x) => x.name), ...openDraftNames(dirty, "")]) {
        const d = getDraft<WorkflowDraft>(draftKey(name));
        if (d) drafts[name] = d.content;
      }
    }
    try {
      setResult(await workflowConfigApi.render({ stepId: step!.id, kind: dispatch ? "subtask" : onReject ? "onReject" : "prompt", feedback, restart, drafts, mode: config.mode.id }));
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    }
  };

  if (!step) return null;
  return (
    <section className="card wf-preview" aria-label={t("workflow.preview.title")}>
      <h2 className="card-title">{t("workflow.preview.title")}</h2>
      <p className="field-help">{t("workflow.preview.help")}</p>
      <div className="wf-preview-controls">
        <select aria-label={t("workflow.preview.step")} value={step.id} onChange={(e) => setStepId(e.target.value)}>
          {steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <select aria-label={t("workflow.preview.kind")} value={onReject ? "onReject" : "prompt"} onChange={(e) => setKind(e.target.value as "prompt" | "onReject")}>
          {dispatch ? (
            <option value="prompt">{t("workflow.subtaskLabel")}</option>
          ) : (
            <>
              <option value="prompt">{t("workflow.promptLabel")}</option>
              {step.onRejectFile && <option value="onReject">{t("workflow.onRejectLabel")}</option>}
            </>
          )}
        </select>
        {!onReject && !dispatch && (
          <label className="wf-check">
            <input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} />
            {t("workflow.preview.restart")}
          </label>
        )}
        <Button icon={Play} onClick={() => void show()}>
          {t("workflow.preview.show")}
        </Button>
      </div>
      {onReject && (
        <input
          className="wf-preview-feedback"
          aria-label={t("workflow.preview.feedback")}
          placeholder={t("workflow.preview.feedbackPlaceholder")}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="field-help">{t("workflow.preview.sample", { key: result.task.key, title: result.task.title })}</p>
          <pre className="wf-rendered">{result.text}</pre>
        </>
      )}
    </section>
  );
}
