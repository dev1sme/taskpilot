import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AGENTS, AGENT_LABELS, type Agent } from "../../shared/agents";
import { formatDuration } from "../../shared/ui/Elapsed";
import { Button } from "../../shared/ui/Button";
import { useWorkspace } from "../workspace";
import { workflowApi } from "./api";
import type { AgentExecution, EffectiveExecution, HandoffCommitRequest, HandoffPreviewResult, LaneScope, MetricsSummary, RunState, SubtaskRun } from "./types";
import "../../shared/ui/dialog.css";
import "./now-card.css";

export const sameLane = (a: LaneScope, b: LaneScope) => a.kind === b.kind && a.stepId === b.stepId && (a.kind !== "subtask" || (b.kind === "subtask" && a.n === b.n));

export function isLaneBlocked(run: RunState, scope: LaneScope, sub?: SubtaskRun) {
  return !!(sub ?? run).recoveryBlocked || !!run.handoffs?.some((op) => sameLane(op.scope, scope) && (op.cleanup === "blocked" || !["committed", "failed"].includes(op.stage)));
}

export interface HandoffTarget {
  scope: LaneScope;
  execution: AgentExecution;
  sub?: SubtaskRun;
}

interface ActionProps extends HandoffTarget {
  taskKey: string;
  run: RunState;
  onChanged: () => void;
}

/** The backend remains authoritative about availability and the exact lane revision. */
export function HandoffAction(props: ActionProps & { onRequest: (target: HandoffTarget) => void }) {
  const { t } = useTranslation("workflow");
  const lane = props.sub ?? props.run;
  if (!lane.sessionId || !["starting", "running", "waiting", "interrupted"].includes(props.run.phase) || !["starting", "running", "waiting", "interrupted"].includes(lane.phase)) return null;
  const blocked = isLaneBlocked(props.run, props.scope, props.sub);
  return (
    <>
      <Button variant="quiet" disabled={blocked} onClick={() => props.onRequest({ scope: props.scope, execution: props.execution, sub: props.sub })}>
        {t("handoff.action")}
      </Button>
      {blocked && (
        <span role="status" className="now-sub">
          {t("handoff.blocked")}
        </span>
      )}
    </>
  );
}

export function HandoffDialog({ taskKey, scope, execution, onChanged, onClose }: ActionProps & { onClose: () => void }) {
  const { t } = useTranslation("workflow");
  const { repo } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [target, setTarget] = useState<AgentExecution>(execution);
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState<HandoffPreviewResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the complete request after an uncertain response: retry must use the same operation id.
  const [request, setRequest] = useState<HandoffCommitRequest | null>(null);
  const capabilities = useQuery({ queryKey: ["agent-capabilities", repo?.path], queryFn: workflowApi.capabilities });
  const capability = capabilities.data?.agents.find((item) => item.agent === target.agent);
  const models = target.agent === "codex" && capability?.models.status === "supported" ? capability.models.items : [];
  const saved = target.model && !models.some((item) => item.model === target.model) ? target.model : undefined;
  const scopeLabel = scope.kind === "subtask" ? t("handoff.memberScope", { n: scope.n, step: scope.stepId }) : t("handoff.stepScope", { step: scope.stepId });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  const reset = () => {
    setReviewed(null);
    setConsent(false);
    setError(null);
    setRequest(null);
  };
  const preview = async () => {
    reset();
    setBusy(true);
    try {
      setReviewed(await workflowApi.previewHandoff(taskKey, { scope, target, ...(reason.trim() ? { reason } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const commit = async () => {
    if (!reviewed || (reviewed.requiresConfirmation && !consent)) return;
    const p = reviewed.preview;
    const commitRequest = request ?? {
      scope,
      target,
      ...(reason.trim() ? { reason } : {}),
      previewId: p.id,
      fingerprint: p.fingerprint,
      sourceSessionId: p.sourceSessionId,
      expectedGeneration: p.expectedGeneration,
      operationId: crypto.randomUUID(),
      confirmStop: consent,
    };
    setRequest(commitRequest);
    setBusy(true);
    setError(null);
    try {
      const { operation } = await workflowApi.commitHandoff(taskKey, commitRequest);
      if (operation.error || operation.cleanup === "blocked" || operation.recovery || operation.stage !== "committed" || operation.promptState !== "sent") {
        setError(operation.error ?? t("handoff.uncertain"));
      } else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const locked = busy || !!request;
  const describe = (value: EffectiveExecution) =>
    `${AGENT_LABELS[value.agent]} · ${value.model ?? t("selection.defaultModel")} · ${t("selection.permission", { value: value.permissionMode ?? "default" })}${value.subagent ? ` · ${value.subagent}` : ""}`;
  return createPortal(
    <dialog
      ref={dialog}
      className="dialog dialog-wide handoff-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={`${id}-title`}>{t("handoff.title")}</h2>
        <Button disabled={busy} onClick={onClose}>
          {t("handoff.close")}
        </Button>
      </header>
      <p className="handoff-scope">{scopeLabel}</p>
      <p className="now-sub">{t("handoff.scopeHint")}</p>
      <div className="run-options-controls">
        <label className="mode-picker">
          <span>{t("selection.agent")}</span>
          <select
            value={target.agent}
            disabled={locked}
            onChange={(e) => {
              reset();
              setTarget({ agent: e.target.value as Agent });
            }}
          >
            {AGENTS.map((agent) => (
              <option key={agent} value={agent}>
                {AGENT_LABELS[agent]}
              </option>
            ))}
          </select>
        </label>
        <label className="mode-picker">
          <span>{t("selection.model")}</span>
          <select
            value={target.model ?? ""}
            disabled={locked}
            onChange={(e) => {
              reset();
              setTarget({ agent: target.agent, ...(e.target.value ? { model: e.target.value } : {}) });
            }}
          >
            <option value="">{t("selection.defaultModel")}</option>
            {saved && (
              <option value={saved} disabled>
                {t("selection.savedModel", { model: saved })}
              </option>
            )}
            {models.map((model) => (
              <option key={model.id} value={model.model}>
                {model.displayName ?? model.model}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="now-sub">{t("selection.defaultHint")}</p>
      {(capability?.models.status !== "supported" || capability?.login.status === "unknown") && <p className="now-sub">{t("selection.unverified", { agent: AGENT_LABELS[target.agent] })}</p>}
      {capabilities.error && (
        <p className="error" role="alert">
          {capabilities.error.message}
        </p>
      )}
      <label className="handoff-reason">
        {t("handoff.reason")}
        <textarea
          rows={2}
          maxLength={32000}
          value={reason}
          disabled={locked}
          onChange={(e) => {
            reset();
            setReason(e.target.value);
          }}
        />
      </label>
      {reviewed && (
        <section className="handoff-preview" aria-label={t("handoff.preview")}>
          <p>
            {describe(reviewed.preview.source)} → {describe(reviewed.preview.target)}
          </p>
          {reviewed.preflight.status === "unknown" && <p className="now-sub">{t("selection.previewUnknown")}</p>}
          {reviewed.preflight.errors.map((problem, i) => (
            <p className="error" role="alert" key={i}>
              {problem.field}: {problem.message}
            </p>
          ))}
          <pre>{reviewed.preview.text}</pre>
          {reviewed.requiresConfirmation && (
            <label className="handoff-consent">
              <input type="checkbox" checked={consent} disabled={locked} onChange={(e) => setConsent(e.target.checked)} />
              {t("handoff.consent")}
            </label>
          )}
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {error && <p className="now-sub">{request ? t("handoff.uncertain") : t("handoff.previewError")}</p>}
      <footer className="dialog-actions">
        <Button disabled={locked} busy={busy && !request} onClick={() => void preview()}>
          {t("handoff.preview")}
        </Button>
        <Button
          variant="primary"
          busy={busy && !!request}
          disabled={busy || !reviewed || reviewed.preflight.status === "blocked" || !!reviewed.preflight.errors.length || (reviewed.requiresConfirmation && !consent)}
          onClick={() => void commit()}
        >
          {t(request ? "handoff.retryCommit" : "handoff.confirm")}
        </Button>
      </footer>
    </dialog>,
    document.body,
  );
}

export function UsageSummary({ usage }: { usage: MetricsSummary }) {
  const { t } = useTranslation("workflow");
  const counter = (key: keyof MetricsSummary["totals"], value: number | undefined) =>
    value === undefined ? t("handoff.missing") : key === "costUsd" ? `$${value.toFixed(2)}` : value.toLocaleString("vi-VN");
  return (
    <details className="handoff-usage">
      <summary>{t("handoff.usage", { count: usage.sessions.length })}</summary>
      <p className="now-sub">{t("handoff.cumulative")}</p>
      <dl>
        {(["costUsd", "inputTokens", "outputTokens"] as const).map((key) => (
          <div key={key}>
            <dt>{t(`handoff.counters.${key}`)}</dt>
            <dd>
              {counter(key, usage.totals[key])} · {t("handoff.coverage", { known: usage.coverage[key], total: usage.sessions.length })}
            </dd>
          </div>
        ))}
      </dl>
      {usage.sessions.map((session) => (
        <article key={session.sessionId} className="handoff-usage-session">
          <code>{session.sessionId}</code> · {session.agent ? AGENT_LABELS[session.agent] : t("handoff.missing")}
          <p>{t("handoff.actualModel", { model: session.actualModels.join(", ") || t("handoff.missing") })}</p>
          {session.nativeId && <p>{t("handoff.nativeId", { id: session.nativeId })}</p>}
          <p>{(["costUsd", "inputTokens", "outputTokens"] as const).map((key) => `${t(`handoff.counters.${key}`)}: ${counter(key, session.metrics[key])}`).join(" · ")}</p>
          {session.measurements.map((measurement, i) => (
            <p className="now-sub" key={i}>
              {t(`handoff.sources.${measurement.source}`)} · {measurement.observedAt ? new Date(measurement.observedAt).toLocaleString("vi-VN") : t("handoff.missingTime")}
              {measurement.metrics.durationMs !== undefined && ` · ${formatDuration(measurement.metrics.durationMs)}`}
            </p>
          ))}
        </article>
      ))}
    </details>
  );
}

export function WorkflowHistory({ run, usage, onOpenTerminal }: { run: RunState; usage?: MetricsSummary | null; onOpenTerminal: (id: string) => void }) {
  const { t } = useTranslation("workflow");
  return (
    <section className="handoff-history" aria-label={t("handoff.history")}>
      {!!run.handoffs?.length && (
        <details>
          <summary>{t("handoff.history")}</summary>
          {run.handoffs.map((op) => (
            <article key={op.operationId}>
              <p>
                <strong>{op.scope.kind === "subtask" ? t("handoff.memberScope", { n: op.scope.n, step: op.scope.stepId }) : t("handoff.stepScope", { step: op.scope.stepId })}</strong> ·{" "}
                {t(`handoff.stages.${op.stage}`)} · {new Date(op.updatedAt).toLocaleString("vi-VN")}
              </p>
              <p>{t("handoff.target", { agent: AGENT_LABELS[op.target.agent], model: op.target.model ?? t("selection.defaultModel") })}</p>
              {op.reason && (
                <p>
                  {t("handoff.reason")}: {op.reason}
                </p>
              )}
              {op.error && (
                <p className="error" role="alert">
                  {op.error}
                </p>
              )}
              {op.cleanup === "blocked" || op.recovery === "blocked" ? (
                <p>{t("handoff.blocked")}</p>
              ) : op.error || op.recovery || op.stage === "failed" ? (
                <p>{t(op.stage === "committed" ? "handoff.recoverTarget" : "handoff.recoverSource")}</p>
              ) : (
                op.stage === "committed" && <p>{t(op.promptState === "sent" ? "handoff.delivered" : "handoff.uncertain")}</p>
              )}
              <div className="now-actions">
                <Button variant="quiet" onClick={() => onOpenTerminal(op.sourceSessionId)}>
                  {t("handoff.sourceSession")}
                </Button>
                {op.targetSessionId && (
                  <Button variant="quiet" onClick={() => onOpenTerminal(op.targetSessionId!)}>
                    {t("handoff.targetSession")}
                  </Button>
                )}
              </div>
              <details>
                <summary>{t("handoff.content")}</summary>
                <pre>{op.text}</pre>
              </details>
            </article>
          ))}
        </details>
      )}
      {!!run.attempts?.length && (
        <details>
          <summary>{t("handoff.attempts")}</summary>
          {run.attempts.map((attempt) => (
            <article key={attempt.id}>
              <p>
                {attempt.scope.kind === "subtask" ? t("handoff.memberScope", { n: attempt.scope.n, step: attempt.scope.stepId }) : t("handoff.stepScope", { step: attempt.scope.stepId })} ·{" "}
                {t("handoff.generation", { value: attempt.generation })}
              </p>
              <p>
                {t("handoff.attemptConfig", {
                  agent: AGENT_LABELS[attempt.execution.agent],
                  requested: attempt.execution.model ?? t("selection.defaultModel"),
                  actual: attempt.actualModel ?? t("handoff.missing"),
                })}
              </p>
              <Button variant="quiet" onClick={() => onOpenTerminal(attempt.sessionId)}>
                {attempt.sessionId}
              </Button>
            </article>
          ))}
        </details>
      )}
      {usage && <UsageSummary usage={usage} />}
    </section>
  );
}
