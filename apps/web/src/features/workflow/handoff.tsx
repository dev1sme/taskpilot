import type { AgentExecution, EffectiveExecution, HandoffCommitRequest, HandoffPreviewResult, LaneScope, MetricsSummary, RunState, SubtaskRun } from "@taskpilot/server/api-types";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { locale } from "@/i18n";
import { PROVIDER_LABELS } from "@taskpilot/shared";
import { formatDuration } from "@/lib/time";
import { refreshTask, workflowApi } from "./queries";
import { ExecutionFields } from "./run-options";

const LIVE = ["starting", "running", "waiting", "interrupted"];

export const sameLane = (a: LaneScope, b: LaneScope) => a.kind === b.kind && a.stepId === b.stepId && (a.kind !== "subtask" || (b.kind === "subtask" && a.n === b.n));

/** A lane under a transfer (or one recovery fenced) takes no other action until it settles. */
export function isLaneBlocked(run: RunState, scope: LaneScope, sub?: SubtaskRun): boolean {
  return Boolean((sub ?? run).recoveryBlocked) || Boolean(run.handoffs?.some((op) => sameLane(op.scope, scope) && (op.cleanup === "blocked" || !["committed", "failed"].includes(op.stage))));
}

/** The lane to hand over and the execution it runs now. */
export interface HandoffTarget {
  scope: LaneScope;
  execution: AgentExecution;
  sub?: SubtaskRun;
}

/** "Tiếp tục bằng…": only for a live lane with a session; the server remains authoritative. */
export function HandoffAction({ run, target, onRequest }: { run: RunState; target: HandoffTarget; onRequest: (target: HandoffTarget) => void }) {
  const { t } = useTranslation("workflow");
  const lane = target.sub ?? run;
  if (!lane.sessionId || !LIVE.includes(run.phase) || !LIVE.includes(lane.phase)) return null;
  const blocked = isLaneBlocked(run, target.scope, target.sub);
  return (
    <>
      <Button variant="ghost" disabled={blocked} onClick={() => onRequest(target)}>
        <ArrowsLeftRight aria-hidden />
        {t("handoff.action")}
      </Button>
      {blocked && (
        <span role="status" className="self-center text-xs text-muted">
          {t("handoff.blocked")}
        </span>
      )}
    </>
  );
}

const scopeLabel = (t: (key: "handoff.memberScope" | "handoff.stepScope", values: Record<string, unknown>) => string, scope: LaneScope) =>
  scope.kind === "subtask" ? t("handoff.memberScope", { n: scope.n, step: scope.stepId }) : t("handoff.stepScope", { step: scope.stepId });

/** Review, then commit, a handoff of one lane to another agent or model, keeping its documents and history. */
export function HandoffDialog({ taskKey, target, onClose }: { taskKey: string; target: HandoffTarget | null; onClose: () => void }) {
  return target ? <HandoffForm key={JSON.stringify(target.scope)} taskKey={taskKey} target={target} onClose={onClose} /> : null;
}

function HandoffForm({ taskKey, target: lane, onClose }: { taskKey: string; target: HandoffTarget; onClose: () => void }) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const [target, setTarget] = useState<AgentExecution>(() => ({ agent: lane.execution.agent, ...(lane.execution.model ? { model: lane.execution.model } : {}) }));
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState<HandoffPreviewResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept after an uncertain answer: a retry must reuse the same operation id.
  const [request, setRequest] = useState<HandoffCommitRequest | null>(null);
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
      setReviewed(await workflowApi.previewHandoff(taskKey, { scope: lane.scope, target, ...(reason.trim() ? { reason } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void refreshTask(taskKey);
    }
  };
  const commit = async () => {
    if (!reviewed || (reviewed.requiresConfirmation && !consent)) return;
    const p = reviewed.preview;
    const next = request ?? {
      scope: lane.scope,
      target,
      ...(reason.trim() ? { reason } : {}),
      previewId: p.id,
      fingerprint: p.fingerprint,
      sourceSessionId: p.sourceSessionId,
      expectedGeneration: p.expectedGeneration,
      operationId: crypto.randomUUID(),
      confirmStop: consent,
    };
    setRequest(next);
    setBusy(true);
    setError(null);
    try {
      const { operation } = await workflowApi.commitHandoff(taskKey, next);
      if (operation.error || operation.cleanup === "blocked" || operation.recovery || operation.stage !== "committed" || operation.promptState !== "sent")
        setError(operation.error ?? t("handoff.uncertain"));
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void refreshTask(taskKey);
    }
  };
  const locked = busy || request !== null;
  const describe = (value: EffectiveExecution) =>
    `${PROVIDER_LABELS[value.agent]} · ${value.model ?? t("selection.defaultModel")} · ${t("selection.permission", { value: value.permissionMode ?? "default" })}${value.subagent ? ` · ${value.subagent}` : ""}`;
  const blocked = !reviewed || reviewed.preflight.status === "blocked" || reviewed.preflight.errors.length > 0 || (reviewed.requiresConfirmation && !consent);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("handoff.title")}</DialogTitle>
          <DialogDescription>
            {scopeLabel(t, lane.scope)} · {t("handoff.scopeHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <ExecutionFields
            value={target}
            disabled={locked}
            onChange={(next) => {
              if (next.agent === "workflow") return;
              reset();
              setTarget(next);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reason`}>{t("handoff.reason")}</Label>
          <Textarea
            id={`${id}-reason`}
            rows={2}
            maxLength={32000}
            value={reason}
            disabled={locked}
            onChange={(e) => {
              reset();
              setReason(e.target.value);
            }}
          />
        </div>
        {reviewed && (
          <section aria-label={t("handoff.preview")} className="grid gap-2 rounded-sm border border-line bg-sunken p-3 text-sm">
            <p>
              {describe(reviewed.preview.source)} → {describe(reviewed.preview.target)}
            </p>
            {reviewed.preflight.status === "unknown" && <p className="text-xs text-muted">{t("selection.previewUnknown")}</p>}
            {reviewed.preflight.errors.map((problem, i) => (
              <p key={i} role="alert" className="text-danger">
                {problem.field}: {problem.message}
              </p>
            ))}
            <pre className="max-h-64 overflow-auto rounded-sm bg-bg p-2 font-mono text-xs whitespace-pre-wrap">{reviewed.preview.text}</pre>
            {reviewed.requiresConfirmation && (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 size-4 accent-[var(--signal)]" checked={consent} disabled={locked} onChange={(e) => setConsent(e.target.checked)} />
                {t("handoff.consent")}
              </label>
            )}
          </section>
        )}
        {error && (
          <div role="alert" className="grid gap-1 text-sm">
            <p className="text-danger">{error}</p>
            <p className="text-muted">{request ? t("handoff.uncertain") : t("handoff.previewError")}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("handoff.close")}
          </Button>
          <Button disabled={locked} busy={busy && !request} onClick={() => void preview()}>
            {t("handoff.preview")}
          </Button>
          <Button variant="primary" busy={busy && request !== null} disabled={busy || blocked} onClick={() => void commit()}>
            {t(request ? "handoff.retryCommit" : "handoff.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const counter = (key: keyof MetricsSummary["totals"], value: number | undefined, missing: string) =>
  value === undefined ? missing : key === "costUsd" ? `$${value.toFixed(2)}` : value.toLocaleString(locale());

/** Cumulative cost and token counts per session, with how much of it is known. */
export function UsageSummary({ usage }: { usage: MetricsSummary }) {
  const { t } = useTranslation("workflow");
  const missing = t("handoff.missing");
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="flex min-h-10 items-center px-3 text-sm font-medium">{t("handoff.usage", { count: usage.sessions.length })}</summary>
      <div className="grid gap-3 border-t border-line p-3 text-sm">
        <p className="text-xs text-muted">{t("handoff.cumulative")}</p>
        <dl className="grid gap-1 sm:grid-cols-3">
          {(["costUsd", "inputTokens", "outputTokens"] as const).map((key) => (
            <div key={key} className="rounded-sm bg-sunken p-2">
              <dt className="text-xs text-faint">{t(`handoff.counters.${key}`)}</dt>
              <dd className="font-mono">
                {counter(key, usage.totals[key], missing)} <span className="text-xs text-faint">· {t("handoff.coverage", { known: usage.coverage[key], total: usage.sessions.length })}</span>
              </dd>
            </div>
          ))}
        </dl>
        {usage.sessions.map((session) => (
          <article key={session.sessionId} className="grid gap-0.5 border-t border-line pt-2">
            <p>
              <code>{session.sessionId}</code> · {session.agent ? PROVIDER_LABELS[session.agent] : missing}
            </p>
            <p className="text-muted">{t("handoff.actualModel", { model: session.actualModels.join(", ") || missing })}</p>
            {session.nativeId && <p className="text-muted">{t("handoff.nativeId", { id: session.nativeId })}</p>}
            <p className="font-mono text-xs">
              {(["costUsd", "inputTokens", "outputTokens"] as const).map((key) => `${t(`handoff.counters.${key}`)}: ${counter(key, session.metrics[key], missing)}`).join(" · ")}
            </p>
            {session.measurements.map((measurement, i) => (
              <p key={i} className="text-xs text-faint">
                {t(`handoff.sources.${measurement.source}`)} · {measurement.observedAt ? new Date(measurement.observedAt).toLocaleString(locale()) : t("handoff.missingTime")}
                {measurement.metrics.durationMs !== undefined && ` · ${formatDuration(measurement.metrics.durationMs)}`}
              </p>
            ))}
          </article>
        ))}
      </div>
    </details>
  );
}

/** Handoffs and attempts of the run, and its usage: the audit trail behind the current state. */
export function RunHistory({ run, usage, onOpenSession }: { run: RunState; usage: MetricsSummary | null; onOpenSession?: (id: string) => void }) {
  const { t } = useTranslation("workflow");
  if (!run.handoffs?.length && !run.attempts?.length && !usage) return null;
  const sessionButton = (id: string, label: string) =>
    onOpenSession && (
      <Button size="sm" variant="ghost" onClick={() => onOpenSession(id)}>
        {label}
      </Button>
    );
  return (
    <section aria-label={t("handoff.history")} className="grid gap-2">
      {!!run.handoffs?.length && (
        <details className="rounded-md border border-line bg-surface">
          <summary className="flex min-h-10 items-center px-3 text-sm font-medium">{t("handoff.history")}</summary>
          <div className="grid gap-3 border-t border-line p-3 text-sm">
            {run.handoffs.map((op) => (
              <article key={op.operationId} className="grid gap-1">
                <p>
                  <strong>{scopeLabel(t, op.scope)}</strong> · {t(`handoff.stages.${op.stage}`)} · {new Date(op.updatedAt).toLocaleString(locale())}
                </p>
                <p className="text-muted">{t("handoff.target", { agent: PROVIDER_LABELS[op.target.agent], model: op.target.model ?? t("selection.defaultModel") })}</p>
                {op.reason && (
                  <p>
                    {t("handoff.reason")}: {op.reason}
                  </p>
                )}
                {op.error && (
                  <p role="alert" className="text-danger">
                    {op.error}
                  </p>
                )}
                <p className="text-muted">
                  {op.cleanup === "blocked" || op.recovery === "blocked"
                    ? t("handoff.blocked")
                    : op.error || op.recovery || op.stage === "failed"
                      ? t(op.stage === "committed" ? "handoff.recoverTarget" : "handoff.recoverSource")
                      : op.stage === "committed"
                        ? t(op.promptState === "sent" ? "handoff.delivered" : "handoff.uncertain")
                        : null}
                </p>
                <div className="flex flex-wrap gap-1">
                  {sessionButton(op.sourceSessionId, t("handoff.sourceSession"))}
                  {op.targetSessionId && sessionButton(op.targetSessionId, t("handoff.targetSession"))}
                </div>
                <details>
                  <summary className="text-xs text-signal-text">{t("handoff.content")}</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-sunken p-2 font-mono text-xs whitespace-pre-wrap">{op.text}</pre>
                </details>
              </article>
            ))}
          </div>
        </details>
      )}
      {!!run.attempts?.length && (
        <details className="rounded-md border border-line bg-surface">
          <summary className="flex min-h-10 items-center px-3 text-sm font-medium">{t("handoff.attempts")}</summary>
          <div className="grid gap-2 border-t border-line p-3 text-sm">
            {run.attempts.map((attempt) => (
              <article key={attempt.id} className="grid gap-0.5">
                <p>
                  {scopeLabel(t, attempt.scope)} · {t("handoff.generation", { value: attempt.generation })}
                </p>
                <p className="text-muted">
                  {t("handoff.attemptConfig", {
                    agent: PROVIDER_LABELS[attempt.execution.agent],
                    requested: attempt.execution.model ?? t("selection.defaultModel"),
                    actual: attempt.actualModel ?? t("handoff.missing"),
                  })}
                </p>
                {sessionButton(attempt.sessionId, attempt.sessionId)}
              </article>
            ))}
          </div>
        </details>
      )}
      {usage && <UsageSummary usage={usage} />}
    </section>
  );
}
