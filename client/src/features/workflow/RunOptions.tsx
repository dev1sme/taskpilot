import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PROVIDER_LABELS } from "../../shared/providers";
import { Button } from "../../shared/ui/Button";
import { useWorkspace } from "../workspace";
import { workflowApi } from "./api";
import { ExecutionCapabilityNotice, ExecutionFields } from "./ExecutionFields";
import { useAgentCapabilities } from "./useAgentCapabilities";
import { ModePicker } from "./ModePicker";
import type { RunOptionsValue } from "./types";
import "./now-card.css";

interface Props {
  taskKey: string;
  initial?: RunOptionsValue;
  disabled?: boolean;
  children: (options: RunOptionsValue, blocked: boolean) => ReactNode;
}

/** Each mounted form belongs to one repo/task/run. Restart starts from the run's requested choice. */
export function RunOptions(props: Props) {
  const { repo } = useWorkspace();
  return <OptionsForm key={`${repo?.path}:${props.taskKey}`} {...props} />;
}

function OptionsForm({ taskKey, initial, disabled, children }: Props) {
  const { t } = useTranslation("workflow");
  const { repo } = useWorkspace();
  const cache = useQueryClient();
  const [value, setValue] = useState<RunOptionsValue>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const defaults = useQuery({ queryKey: ["execution-defaults", repo?.path], queryFn: workflowApi.defaults, enabled: !!repo?.path });
  const modes = useQuery({ queryKey: ["workflow-modes", repo?.path], queryFn: workflowApi.modes, enabled: !!repo?.path });
  const capabilities = useAgentCapabilities();
  const execution = value.execution ?? defaults.data?.execution ?? { agent: "workflow" as const };
  // Submit the resolved values shown on screen, even if defaults change before the request arrives.
  const options = { mode: value.mode ?? modes.data?.selected, execution };
  const signature = JSON.stringify(options);
  const preview = useQuery({
    queryKey: ["run-preview", repo?.path, taskKey, signature],
    queryFn: () => workflowApi.preview(taskKey, options),
    enabled: previewFor === signature,
  });
  const shown = previewFor === signature ? preview.data : undefined;
  const dataError = defaults.error ?? modes.error;
  const diagnostics = defaults.data?.errors ?? [];
  const missingMode = modes.data && !modes.data.modes.some((mode) => mode.id === options.mode);
  const unavailable = !defaults.data || !modes.data || !!dataError || diagnostics.length > 0 || !!missingMode;
  const blocked = unavailable || saving || (previewFor === signature && !!preview.error) || (shown?.errors.length ?? 0) > 0;
  const lock = disabled || saving;
  const source = value.execution
    ? initial?.execution && JSON.stringify(value.execution) === JSON.stringify(initial.execution)
      ? "run"
      : "request"
    : defaults.data?.execution
      ? "repo"
      : "workflow";

  const change = (next: RunOptionsValue) => {
    setValue(next);
    setPreviewFor(null);
    setMessage(null);
    setSaveError(null);
  };
  const save = async (kind: "execution" | "mode") => {
    if (!defaults.data || !options.mode) return;
    setSaving(true);
    setSaveError(null);
    setMessage(null);
    try {
      if (kind === "execution") await workflowApi.saveDefaults(execution, defaults.data.hash);
      else await workflowApi.saveMode(options.mode, defaults.data.hash);
      setMessage(t(kind === "execution" ? "selection.saved" : "selection.modeSaved"));
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      // Refresh hashes after either success or a stale-write conflict. Preserve the user's draft.
      await Promise.all(["execution-defaults", "workflow-modes", "run-preview", "workflow"].map((key) => cache.invalidateQueries({ queryKey: [key] })));
      setSaving(false);
    }
  };

  return (
    <div className="run-options" aria-label={t("selection.label")}>
      <div className="run-options-controls">
        <ModePicker value={options.mode} onChange={(mode) => change({ ...value, mode })} disabled={lock} />
        <ExecutionFields
          value={execution}
          capabilities={capabilities}
          allowWorkflow
          disabled={lock}
          providerDisabled={!defaults.data}
          onChange={(execution) => change({ ...value, execution })}
        />
      </div>
      <p className="now-sub">
        <span>{t("selection.source", { source: t(`selection.sources.${source}`) })}</span> <span>{t("selection.scope")}</span>
      </p>
      <ExecutionCapabilityNotice value={execution} capabilities={capabilities} />
      {dataError && (
        <p className="error" role="alert">
          {dataError.message}
        </p>
      )}
      {missingMode && (
        <p className="error" role="alert">
          {t("selection.missingMode", { mode: options.mode })}
        </p>
      )}
      {diagnostics.map((problem, index) => (
        <p className="error" role="alert" key={index}>
          {problem.field}: {problem.message}
        </p>
      ))}
      {saveError && (
        <p className="error" role="alert">
          {saveError}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="now-actions">
        <Button
          disabled={lock || unavailable}
          onClick={() => {
            setPreviewFor(signature);
            void preview.refetch();
          }}
          busy={preview.isFetching}
        >
          {t("selection.preview")}
        </Button>
        <Button variant="quiet" disabled={lock || blocked} onClick={() => void save("execution")}>
          {t("selection.save")}
        </Button>
        <Button variant="quiet" disabled={lock || blocked} onClick={() => void save("mode")}>
          {t("selection.saveMode")}
        </Button>
        <Button
          variant="quiet"
          disabled={lock}
          onClick={() => {
            void defaults.refetch();
            void modes.refetch();
            void capabilities.refetch();
            setPreviewFor(null);
          }}
        >
          {t("selection.refresh")}
        </Button>
      </div>
      {previewFor === signature && preview.error && (
        <p className="error" role="alert">
          {preview.error.message}
        </p>
      )}
      {shown && (
        <div className="run-options-preview" aria-label={t("selection.preview")}>
          <p>{t("selection.previewSource", { mode: shown.workflow.mode.name, source: t(`selection.sources.${shown.source}`) })}</p>
          <ul>
            {shown.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.id}</strong>: {PROVIDER_LABELS[step.configured.agent]} / {step.configured.model ?? t("selection.defaultModel")}
                {" → "}
                {PROVIDER_LABELS[step.effective.agent]} / {step.effective.model ?? t("selection.defaultModel")}
                {" · "}
                {t("selection.permission", { value: step.effective.permissionMode ?? "default" })}
                {step.effective.subagent && ` · ${step.effective.subagent}`}
                {step.prompt && (
                  <details>
                    <summary>{t("selection.prompt")}</summary>
                    <pre>{step.prompt}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {shown.warnings.length > 0 && <p className="now-sub">{t("selection.previewUnknown")}</p>}
          {shown.errors.map((problem, index) => (
            <p className="error" role="alert" key={index}>
              {problem.stepId} · {problem.field}: {problem.message}
            </p>
          ))}
        </div>
      )}
      <div className="now-actions">{children(options, blocked)}</div>
    </div>
  );
}
