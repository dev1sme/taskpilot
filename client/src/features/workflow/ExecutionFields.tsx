import { useTranslation } from "react-i18next";
import { isProviderId, PROVIDER_IDS, PROVIDER_LABELS } from "../../shared/providers";
import type { ExecutionSelection } from "./types";
import { executionCapability, useAgentCapabilities } from "./useAgentCapabilities";

type Capabilities = ReturnType<typeof useAgentCapabilities>;
interface Props {
  value: ExecutionSelection;
  capabilities: Capabilities;
  onChange: (value: ExecutionSelection) => void;
  allowWorkflow?: boolean;
  disabled?: boolean;
  providerDisabled?: boolean;
}

/** Controlled fields only; the caller owns policy, drafts and transactions. */
export function ExecutionFields({ value, capabilities, onChange, allowWorkflow, disabled, providerDisabled }: Props) {
  const { t } = useTranslation("workflow");
  const { models, savedModel } = executionCapability(capabilities.data, value);
  return (
    <>
      <label className="mode-picker">
        <span>{t("selection.agent")}</span>
        <select
          value={value.agent}
          disabled={disabled || providerDisabled}
          onChange={(event) => {
            const agent = event.target.value;
            if (isProviderId(agent)) onChange({ agent });
            else if (allowWorkflow && agent === "workflow") onChange({ agent });
          }}
        >
          {allowWorkflow && <option value="workflow">{t("selection.workflow")}</option>}
          {PROVIDER_IDS.map((agent) => (
            <option key={agent} value={agent}>
              {PROVIDER_LABELS[agent]}
            </option>
          ))}
        </select>
      </label>
      <label className="mode-picker">
        <span>{t("selection.model")}</span>
        <select
          value={value.model ?? ""}
          disabled={disabled || value.agent === "workflow"}
          onChange={(event) => {
            if (value.agent !== "workflow") onChange({ agent: value.agent, ...(event.target.value ? { model: event.target.value } : {}) });
          }}
        >
          <option value="">{t(value.agent === "workflow" ? "selection.workflowModel" : "selection.defaultModel")}</option>
          {savedModel && (
            <option value={savedModel} disabled>
              {t("selection.savedModel", { model: savedModel })}
            </option>
          )}
          {models.map((model) => (
            <option key={model.id} value={model.model}>
              {model.displayName ?? model.model}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function ExecutionCapabilityNotice({ value, capabilities }: Pick<Props, "value" | "capabilities">) {
  const { t } = useTranslation("workflow");
  const { capability } = executionCapability(capabilities.data, value);
  return (
    <>
      {value.agent !== "workflow" && <p className="now-sub">{t("selection.defaultHint")}</p>}
      {value.agent !== "workflow" && (capability?.models.status !== "supported" || capability?.login.status === "unknown") && (
        <p className="now-sub">{t("selection.unverified", { agent: PROVIDER_LABELS[value.agent] })}</p>
      )}
      {capability?.cli.error && (
        <p className="error" role="alert">
          {capability.cli.error.message}
        </p>
      )}
      {capabilities.error && (
        <p className="error" role="alert">
          {capabilities.error.message}
        </p>
      )}
    </>
  );
}
