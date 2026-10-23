import { Play } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { AGENT_LABELS } from "../../../shared/agents";
import { useWorkspace } from "../../workspace";
import type { ExecutionSelection } from "../../workflow";
import { getDraft, useDrafts } from "../shared/drafts";
import { workflowConfigApi } from "./api";
import type { RenderedPrompt, WorkflowConfig, WorkflowDraft } from "./types";
import { draftKey, openDraftNames } from "./workflow-files";

/**
 * The prompt a step would send, rendered by the server for a sample task from the workflow plus open
 * drafts. A real task's prompts are on its own screen ("Prompt đã gửi"): a task that already ran
 * got the prompt of the workflow it started with, which this page cannot show.
 */
export function PromptPreview(props: { config: WorkflowConfig; execution?: ExecutionSelection }) {
  const { repo } = useWorkspace();
  return <PreviewForm key={`${repo?.path}:${props.config.mode.id}`} {...props} />;
}

function PreviewForm({ config, execution }: { config: WorkflowConfig; execution?: ExecutionSelection }) {
  const { t } = useTranslation("config");
  const steps = config.def?.steps ?? [];
  const [stepId, setStepId] = useState("");
  const [kind, setKind] = useState<"prompt" | "onReject">("prompt");
  const [restart, setRestart] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [rendered, setResult] = useState<{ signature: string; value: RenderedPrompt } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDrafts();

  const step = steps.find((s) => s.id === stepId) ?? steps[0];
  const dispatch = !!step?.dispatch;
  const onReject = !dispatch && kind === "onReject" && !!step?.onRejectFile;
  const drafts: Record<string, string> = {};
  if (config.origin === "repo") {
    for (const name of [...config.files.map((x) => x.name), ...openDraftNames(dirty, "")]) {
      const draft = getDraft<WorkflowDraft>(draftKey(name));
      if (draft) drafts[name] = draft.content;
    }
  }
  const signature = JSON.stringify({ stepId, kind, restart, feedback, execution, resolved: config.resolved, drafts });
  const result = rendered?.signature === signature ? rendered.value : null;

  const show = async () => {
    setError(null);
    try {
      const value = await workflowConfigApi.render({
        stepId: step!.id,
        kind: dispatch ? "subtask" : onReject ? "onReject" : "prompt",
        feedback,
        restart,
        drafts,
        mode: config.mode.id,
        execution: execution ?? { agent: "workflow" },
      });
      setResult({ signature, value });
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
      <p className="field-help">{t(execution ? "workflow.preview.runContext" : "workflow.preview.workflowContext")}</p>
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
          <p className="field-help">
            {t("workflow.preview.effective", { agent: AGENT_LABELS[result.effective.agent], model: result.effective.model ?? t("workflow.preview.defaultModel") })}
          </p>
          <pre className="wf-rendered">{result.text}</pre>
        </>
      )}
    </section>
  );
}
