import type { AgentCapabilities, ExecutionDefaults, ExecutionSelection, WorkflowModes } from "@server/api-types";
import { ArrowsClockwise, Eye } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRepo } from "@/features/workspace/queries";
import { call } from "@/lib/api";
import { PROVIDER_IDS, PROVIDER_LABELS, isProviderId } from "@/lib/providers";
import { queryClient } from "@/lib/query-client";
import { workflowApi, type RunOptions as RunOptionsValue } from "./queries";

export const settingsApi = {
  modes: () => call<WorkflowModes>("GET", "/api/config/workflow/modes"),
  defaults: () => call<ExecutionDefaults>("GET", "/api/config/workflow/execution-defaults"),
  saveDefaults: (execution: ExecutionSelection, baseHash: string) => call<ExecutionDefaults>("PUT", "/api/config/workflow/execution-defaults", { execution, baseHash }),
  saveMode: (mode: string, baseHash: string) => call<{ hash: string }>("PUT", "/api/config/workflow/mode", { mode, baseHash }),
  capabilities: () => call<AgentCapabilities>("GET", "/api/sessions/capabilities"),
};

/** One repo-scoped inventory of what each agent can do, shared by every execution form. */
export function useAgentCapabilities() {
  const repo = useRepo().data?.path;
  return useQuery({ queryKey: ["agent-capabilities", repo], queryFn: settingsApi.capabilities, enabled: Boolean(repo) });
}

function capabilityOf(data: AgentCapabilities | undefined, execution: ExecutionSelection) {
  const capability = data?.agents.find((item) => item.agent === execution.agent);
  const models = capability?.models.status === "supported" ? capability.models.items : [];
  const savedModel = execution.model && !models.some((item) => item.model === execution.model) ? execution.model : undefined;
  return { capability, models, savedModel };
}

const NO_MODEL = "__default__";

/** Agent and model pickers; the caller owns the value. */
export function ExecutionFields({
  value,
  onChange,
  allowWorkflow,
  disabled,
}: {
  value: ExecutionSelection;
  onChange: (value: ExecutionSelection) => void;
  allowWorkflow?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const capabilities = useAgentCapabilities();
  const { models, savedModel } = capabilityOf(capabilities.data, value);
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-agent`} className="text-xs text-muted">
          {t("selection.agent")}
        </Label>
        <Select
          value={value.agent}
          disabled={disabled}
          onValueChange={(agent) => {
            if (isProviderId(agent)) onChange({ agent });
            else if (allowWorkflow && agent === "workflow") onChange({ agent: "workflow" });
          }}
        >
          <SelectTrigger id={`${id}-agent`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowWorkflow && <SelectItem value="workflow">{t("selection.workflow")}</SelectItem>}
            {PROVIDER_IDS.map((agent) => (
              <SelectItem key={agent} value={agent}>
                {PROVIDER_LABELS[agent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-model`} className="text-xs text-muted">
          {t("selection.model")}
        </Label>
        <Select
          value={value.model ?? NO_MODEL}
          disabled={disabled || value.agent === "workflow"}
          onValueChange={(model) => value.agent !== "workflow" && onChange({ agent: value.agent, ...(model !== NO_MODEL ? { model } : {}) })}
        >
          <SelectTrigger id={`${id}-model`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_MODEL}>{t(value.agent === "workflow" ? "selection.workflowModel" : "selection.defaultModel")}</SelectItem>
            {savedModel && (
              <SelectItem value={savedModel} disabled>
                {t("selection.savedModel", { model: savedModel })}
              </SelectItem>
            )}
            {models.map((model) => (
              <SelectItem key={model.id} value={model.model}>
                {model.displayName ?? model.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function ExecutionNotice({ value }: { value: ExecutionSelection }) {
  const { t } = useTranslation("workflow");
  const capabilities = useAgentCapabilities();
  const { capability } = capabilityOf(capabilities.data, value);
  if (value.agent === "workflow") return null;
  return (
    <div className="grid gap-1 text-xs text-muted">
      <p>{t("selection.defaultHint")}</p>
      {(capability?.models.status !== "supported" || capability?.login.status === "unknown") && <p>{t("selection.unverified", { agent: PROVIDER_LABELS[value.agent] })}</p>}
      {capability?.cli.error && (
        <p role="alert" className="text-danger">
          {capability.cli.error.message}
        </p>
      )}
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

/**
 * How a run starts: workflow mode, agent and model, with a preview of what each step would get and
 * the checks that block it. `children` renders the start button with the resolved options.
 */
export function RunOptions({
  taskKey,
  initial,
  disabled,
  children,
}: {
  taskKey: string;
  initial?: RunOptionsValue;
  disabled?: boolean;
  children: (options: RunOptionsValue, blocked: boolean) => ReactNode;
}) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const repo = useRepo().data?.path;
  const [value, setValue] = useState<RunOptionsValue>(initial ?? {});
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const defaults = useQuery({ queryKey: ["execution-defaults", repo], queryFn: settingsApi.defaults, enabled: Boolean(repo) });
  const modes = useQuery({ queryKey: ["workflow-modes", repo], queryFn: settingsApi.modes, enabled: Boolean(repo) });
  const execution: ExecutionSelection = value.execution ?? defaults.data?.execution ?? { agent: "workflow" };
  // Submit the values shown on screen, even if the defaults change before the request arrives.
  const options: RunOptionsValue = { mode: value.mode ?? modes.data?.selected, execution };
  const signature = JSON.stringify(options);
  const preview = useQuery({ queryKey: ["run-preview", repo, taskKey, signature], queryFn: () => workflowApi.preview(taskKey, options), enabled: previewFor === signature });
  const shown = previewFor === signature ? preview.data : undefined;
  const loadError = defaults.error ?? modes.error;
  const diagnostics = defaults.data?.errors ?? [];
  const missingMode = modes.data && !modes.data.modes.some((mode) => mode.id === options.mode);
  const unavailable = !defaults.data || !modes.data || Boolean(loadError) || diagnostics.length > 0 || Boolean(missingMode);
  const blocked = unavailable || saving || (previewFor === signature && Boolean(preview.error)) || (shown?.errors.length ?? 0) > 0;
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
      if (kind === "execution") await settingsApi.saveDefaults(execution, defaults.data.hash);
      else await settingsApi.saveMode(options.mode, defaults.data.hash);
      setMessage(t(kind === "execution" ? "selection.saved" : "selection.modeSaved"));
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      // Fresh hashes after a success or a stale-write conflict; the draft stays.
      await Promise.all(["execution-defaults", "workflow-modes", "run-preview", "workflow"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      setSaving(false);
    }
  };
  const currentMode = modes.data?.modes.find((mode) => mode.id === options.mode);

  return (
    <div className="grid gap-3" aria-label={t("selection.label")}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-mode`} className="text-xs text-muted">
            {t("mode.label")}
          </Label>
          <Select value={options.mode} disabled={lock || !modes.data} onValueChange={(mode) => change({ ...value, mode })}>
            <SelectTrigger id={`${id}-mode`} title={currentMode?.description}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {missingMode && options.mode && (
                <SelectItem value={options.mode} disabled>
                  {options.mode}
                </SelectItem>
              )}
              {modes.data?.modes.map((mode) => (
                <SelectItem key={mode.id} value={mode.id}>
                  {mode.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExecutionFields value={execution} allowWorkflow disabled={lock || !defaults.data} onChange={(next) => change({ ...value, execution: next })} />
      </div>
      <p className="text-xs text-muted">
        {t("selection.source", { source: t(`selection.sources.${source}`) })} {t("selection.scope")}
      </p>
      <ExecutionNotice value={execution} />
      {loadError && <Problem>{loadError.message}</Problem>}
      {missingMode && <Problem>{t("selection.missingMode", { mode: options.mode })}</Problem>}
      {diagnostics.map((problem, index) => (
        <Problem key={index}>
          {problem.field}: {problem.message}
        </Problem>
      ))}
      {saveError && <Problem>{saveError}</Problem>}
      {message && (
        <p role="status" className="text-sm text-done">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={lock || unavailable}
          busy={preview.isFetching}
          onClick={() => {
            setPreviewFor(signature);
            void preview.refetch();
          }}
        >
          <Eye aria-hidden />
          {t("selection.preview")}
        </Button>
        <Button size="sm" variant="ghost" disabled={lock || blocked} onClick={() => void save("execution")}>
          {t("selection.save")}
        </Button>
        <Button size="sm" variant="ghost" disabled={lock || blocked} onClick={() => void save("mode")}>
          {t("selection.saveMode")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={lock}
          onClick={() => {
            void Promise.all(["execution-defaults", "workflow-modes", "agent-capabilities"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
            setPreviewFor(null);
          }}
        >
          <ArrowsClockwise aria-hidden />
          {t("selection.refresh")}
        </Button>
      </div>
      {previewFor === signature && preview.error && <Problem>{preview.error.message}</Problem>}
      {shown && (
        <div aria-label={t("selection.preview")} className="grid gap-2 rounded-sm border border-line bg-sunken p-3 text-sm">
          <p className="text-muted">{t("selection.previewSource", { mode: shown.workflow.mode.name, source: t(`selection.sources.${shown.source}`) })}</p>
          <ul className="grid gap-1.5">
            {shown.steps.map((step) => (
              <li key={step.id}>
                <span className="font-mono">{step.id}</span>: {PROVIDER_LABELS[step.configured.agent]} / {step.configured.model ?? t("selection.defaultModel")} →{" "}
                {PROVIDER_LABELS[step.effective.agent]} / {step.effective.model ?? t("selection.defaultModel")} ·{" "}
                {t("selection.permission", { value: step.effective.permissionMode ?? "default" })}
                {step.effective.subagent && ` · ${step.effective.subagent}`}
                {step.prompt && (
                  <details className="mt-1">
                    <summary className="text-xs text-signal-text">{t("selection.prompt")}</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-bg p-2 font-mono text-xs whitespace-pre-wrap">{step.prompt}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {shown.warnings.length > 0 && <p className="text-xs text-muted">{t("selection.previewUnknown")}</p>}
          {shown.errors.map((problem, index) => (
            <Problem key={index}>
              {problem.stepId} · {problem.field}: {problem.message}
            </Problem>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">{children(options, blocked)}</div>
    </div>
  );
}
