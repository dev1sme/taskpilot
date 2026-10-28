import type { Assignment, MetricsSummary, ParsedAssignments, Question, RunState, SubtaskMetrics, SubtaskRun } from "@server/api-types";
import { ArrowClockwise, CheckCircle, Circle, FileText, HandPalm, PlugsConnected, TerminalWindow } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AgentBadge } from "@/components/agent-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSessions } from "@/features/sessions/queries";
import { useRepo } from "@/features/workspace/queries";
import { locale } from "@/i18n";
import { useInvalidateOn } from "@/lib/events";
import { PROVIDER_LABELS } from "@/lib/providers";
import { formatDuration, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ReplyForm } from "./answers";
import { HandoffAction, isLaneBlocked, UsageSummary, type HandoffTarget } from "./handoff";
import { MarkDoneButton } from "./mark-done";
import { refreshTask, workflowApi } from "./queries";
import { useAgentCapabilities } from "./run-options";

/** The subagent and model the plan's table gives a subtask; nothing when it uses the defaults. */
function RunAs({ item }: { item: Pick<Assignment, "subagent" | "model"> }) {
  const { t } = useTranslation("workflow");
  return (
    <>
      {item.subagent && (
        <span>
          {t("subtasks.subagent")} <code>{item.subagent}</code>
        </span>
      )}
      {item.model && (
        <span>
          {t("subtasks.model")} <code>{item.model}</code>
        </span>
      )}
    </>
  );
}

function Meta({ item }: { item: Pick<Assignment, "subagent" | "model" | "files" | "deps"> }) {
  const { t } = useTranslation("workflow");
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <RunAs item={item} />
      {item.files.length > 0 && <code className="truncate">{item.files.join(", ")}</code>}
      {item.deps.length > 0 && <span>{t("subtasks.after", { list: item.deps.join(", ") })}</span>}
    </p>
  );
}

/** Model, time and cost of an old run's subtask session; a missing part is said, not guessed. */
function LegacyMetrics({ metrics }: { metrics: SubtaskMetrics }) {
  const { t } = useTranslation("workflow");
  return (
    <p aria-label={t("subtasks.metricsLabel")} className="flex flex-wrap gap-x-3 font-mono text-xs text-muted">
      <span>{metrics.model ?? t("subtasks.noModel")}</span>
      {metrics.durationMs !== undefined && <span>{formatDuration(metrics.durationMs)}</span>}
      <span>{metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(2)}` : t("subtasks.noCost")}</span>
      {metrics.inputTokens !== undefined && <span>{t("subtasks.inputTokens", { count: metrics.inputTokens })}</span>}
      {metrics.outputTokens !== undefined && <span>{t("subtasks.outputTokens", { count: metrics.outputTokens })}</span>}
    </p>
  );
}

/** The subtasks the plan's table gives, shown at the gate so the reviewer sees what approving starts. */
export function AssignmentPreview({ assignments, parallel, maxSubtasks }: { assignments: ParsedAssignments; parallel: number; maxSubtasks?: number }) {
  const { t } = useTranslation("workflow");
  const { items, errors } = assignments;
  return (
    <section aria-label={t("subtasks.previewLabel")} className="grid gap-2">
      <h3 className="text-sm font-semibold">
        {maxSubtasks !== undefined ? t("subtasks.previewTitleLimited", { count: items.length, max: maxSubtasks, parallel }) : t("subtasks.previewTitle", { count: items.length, parallel })}
      </h3>
      {errors.length > 0 ? (
        <div role="alert" className="grid gap-1 rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
          <p>{t("subtasks.invalid")}</p>
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="grid gap-1">
          {items.map((item) => (
            <li key={item.n} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-sm border border-line bg-surface p-2.5">
              <span className="font-mono text-sm text-faint">{item.n}</span>
              <div className="grid gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {item.title} <AgentBadge agent={item.agent} />
                </p>
                <Meta item={item} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

interface TreeProps {
  taskKey: string;
  run: RunState;
  stepId: string;
  usage: Record<number, MetricsSummary>;
  questions: Record<number, Question[]>;
  /** Sessions asking for a permission. */
  asking: Set<string>;
  onOpenSession?: (sessionId: string) => void;
  onOpenDoc: (path: string) => void;
  onHandoff: (target: HandoffTarget) => void;
}

/** The subtasks of a running dispatch step: each in its own session, answered and retried on its own. */
export function SubtaskTree(props: TreeProps) {
  const subtasks = props.run.subtasks ?? [];
  return (
    <ol className="grid gap-2">
      {subtasks.map((sub) => (
        <li key={sub.n}>
          <SubtaskRow {...props} sub={sub} />
        </li>
      ))}
    </ol>
  );
}

const PHASE_TONE: Record<SubtaskRun["phase"], "neutral" | "signal" | "attention" | "done"> = {
  pending: "neutral",
  starting: "signal",
  running: "signal",
  waiting: "attention",
  interrupted: "attention",
  done: "done",
};

function SubtaskRow({ sub, ...props }: TreeProps & { sub: SubtaskRun }) {
  const { t } = useTranslation("workflow");
  const [busy, setBusy] = useState(false);
  const scope = { kind: "subtask" as const, stepId: props.stepId, n: sub.n };
  const override = Object.values(props.run.laneOverrides ?? {}).find((item) => item.scope.kind === "subtask" && item.scope.stepId === props.stepId && item.scope.n === sub.n);
  const effective = props.run.attempts?.findLast((a) => a.sessionId === sub.sessionId)?.execution ?? (override ? { ...override.execution, subagent: undefined } : sub);
  const blocked = isLaneBlocked(props.run, scope, sub);
  const permission = sub.sessionId !== undefined && props.asking.has(sub.sessionId);
  const changed = () => void refreshTask(props.taskKey);
  const retry = async () => {
    setBusy(true);
    try {
      await workflowApi.retrySubtask(props.taskKey, sub.n);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      changed();
    }
  };
  const PhaseIcon = sub.phase === "done" ? CheckCircle : sub.phase === "interrupted" ? PlugsConnected : sub.phase === "pending" ? Circle : null;
  const handoffTarget: HandoffTarget = { scope, execution: effective, sub };

  return (
    <article className={cn("grid gap-2 rounded-md border border-line bg-surface p-3", (permission || sub.phase === "waiting" || sub.phase === "interrupted") && "border-attention-line")}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-faint">{sub.n}.</span>
        <span className="min-w-0 flex-1 text-sm font-medium">{sub.title}</span>
        <AgentBadge agent={effective.agent} />
        <Badge tone={permission ? "attention" : PHASE_TONE[sub.phase]}>
          {PhaseIcon && <PhaseIcon weight="fill" aria-hidden />}
          {permission ? t("subtasks.permission") : t(`subtasks.phase.${sub.phase}`)}
        </Badge>
      </header>
      <Meta item={{ ...sub, model: effective.model, subagent: effective.subagent }} />
      {!blocked && sub.noHook && sub.phase !== "done" && <p className="text-xs text-attention">{t("subtasks.noHook", { agent: PROVIDER_LABELS[effective.agent] })}</p>}
      {props.usage[sub.n] ? (
        <UsageSummary usage={props.usage[sub.n]} />
      ) : (
        sub.metrics && (
          <>
            <p className="text-xs text-faint">{t("handoff.sources.legacy")}</p>
            <LegacyMetrics metrics={sub.metrics} />
          </>
        )
      )}
      {!blocked && sub.phase === "waiting" && (
        <ReplyForm send={(text) => workflowApi.replySubtask(props.taskKey, sub.n, text)} questions={props.questions[sub.n] ?? []} agent={PROVIDER_LABELS[effective.agent]} onSent={changed} />
      )}
      {sub.sessionId && sub.phase !== "done" && sub.phase !== "pending" && (
        <QuotaNotice
          taskKey={props.taskKey}
          sessionId={sub.sessionId}
          unknown={sub.phase === "interrupted" || Boolean(sub.noHook)}
          disabled={blocked || busy}
          onRetry={() => void retry()}
          onHandoff={(agent) => props.onHandoff(agent ? { ...handoffTarget, execution: { agent } } : handoffTarget)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {sub.phase === "interrupted" && (
          <Button variant="attention" busy={busy} disabled={blocked} onClick={() => void retry()}>
            <ArrowClockwise aria-hidden />
            {t("subtasks.retry")}
          </Button>
        )}
        {!blocked && permission && props.onOpenSession && (
          <Button variant="attention" onClick={() => props.onOpenSession!(sub.sessionId!)}>
            <HandPalm aria-hidden />
            {t("now.permissionAnswer")}
          </Button>
        )}
        {!blocked && sub.noHook && (sub.phase === "running" || sub.phase === "waiting") && (
          <MarkDoneButton complete={() => workflowApi.completeSubtask(props.taskKey, sub.n)} onDone={changed} />
        )}
        {sub.phase === "done" && (
          <Button variant="ghost" onClick={() => props.onOpenDoc(sub.report)}>
            <FileText aria-hidden />
            {t("subtasks.readReport", { file: sub.report })}
          </Button>
        )}
        {sub.sessionId && sub.phase !== "done" && !permission && props.onOpenSession && (
          <Button variant="ghost" onClick={() => props.onOpenSession!(sub.sessionId!)}>
            <TerminalWindow aria-hidden />
            {t("now.openTerminal")}
          </Button>
        )}
        <HandoffAction run={props.run} target={handoffTarget} onRequest={props.onHandoff} />
      </div>
    </article>
  );
}

/**
 * Why a session may have stopped, with the account's quota evidence, and what to do about it.
 * Suggestions only open the handoff preview; dismissing never changes a run or session.
 */
export function QuotaNotice({
  taskKey,
  sessionId,
  unknown,
  disabled,
  onRetry,
  onHandoff,
}: {
  taskKey: string;
  sessionId: string;
  unknown: boolean;
  disabled: boolean;
  onRetry: () => void;
  onHandoff: (agent?: "codex") => void;
}) {
  const { t } = useTranslation("workflow");
  const repo = useRepo().data?.path;
  const sessions = useSessions(taskKey).data ?? [];
  useInvalidateOn("usage", ["sessions", taskKey]);
  const now = useNow(30_000);
  const session = sessions.find((item) => item.id === sessionId);
  const failure = session?.failure;
  const account = session?.accountQuota;
  const validUntil = account?.validUntil ?? (account ? account.observedAt + 5 * 60_000 : 0);
  const accountFresh = account?.freshness === "fresh" && now >= account.observedAt && now <= validUntil;
  const quota = accountFresh && Boolean(account?.exhausted);
  const capabilities = useAgentCapabilities();
  const codex = capabilities.data?.agents.find((item) => item.agent === "codex");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const identity = `${repo}:${sessionId}:${failure?.observedAt ?? ""}:${account?.observedAt ?? ""}`;
  if (!session || session.retired || session.reservation || dismissed === identity || (!failure && !unknown && !quota)) return null;
  return (
    <div role="status" aria-label={t("quota.label")} className="grid gap-1.5 rounded-sm bg-sunken p-2.5 text-xs text-muted">
      {(failure || unknown) && <p>{t(`quota.reasons.${failure?.reason ?? "unknown"}`)}</p>}
      {failure && <p>{t("quota.turnTime", { time: new Date(failure.observedAt).toLocaleString(locale()) })}</p>}
      {account && (
        <p>
          {t("quota.account", {
            time: new Date(account.observedAt).toLocaleString(locale()),
            source: t(`quota.sources.${account.source}`),
            freshness: t(accountFresh ? "quota.fresh" : "quota.stale"),
          })}
        </p>
      )}
      {quota && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled} onClick={onRetry}>
            {t("quota.retry")}
          </Button>
          {session.agent !== "codex" && codex?.cli.status === "supported" && codex.login.status === "supported" && (
            <Button size="sm" disabled={disabled} onClick={() => onHandoff("codex")}>
              {t("quota.codex")}
            </Button>
          )}
          <Button size="sm" disabled={disabled} onClick={() => onHandoff()}>
            {t("quota.choose")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(identity)}>
            {t("quota.later")}
          </Button>
        </div>
      )}
    </div>
  );
}
