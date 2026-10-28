import { ArrowClockwise, CheckCircle, Circle, FileText, HandPalm, PlugsConnected, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentCapabilities } from "./useAgentCapabilities";
import { PROVIDER_LABELS } from "../../shared/providers";
import { AgentBadge } from "../../shared/ui/AgentBadge";
import { Button } from "../../shared/ui/Button";
import { formatDuration } from "../../shared/ui/Elapsed";
import { useSessions } from "../sessions";
import { useWorkspace } from "../workspace";
import { useInvalidateOnEvent } from "../../shared/api/useInvalidateOnEvent";
import { workflowApi } from "./api";
import { HandoffAction, isLaneBlocked, UsageSummary, type HandoffTarget } from "./HandoffDialog";
import { MarkDoneButton } from "./MarkDoneButton";
import { ReplyForm } from "./ReplyForm";
import type { Assignment, ParsedAssignments, Question, MetricsSummary, RunState, SubtaskMetrics, SubtaskRun } from "./types";
import "./subtask-tree.css";

const AFTER = (deps: number[]) => deps.join(", ");

/** The subagent and model the plan's table gives the subtask; nothing when it uses the defaults. */
function RunAs({ item }: { item: Assignment }) {
  const { t } = useTranslation("workflow");
  return (
    <>
      {item.subagent && (
        <span className="subtask-as">
          {t("subtasks.subagent")} <code>{item.subagent}</code>
        </span>
      )}
      {item.model && (
        <span className="subtask-as">
          {t("subtasks.model")} <code>{item.model}</code>
        </span>
      )}
    </>
  );
}

/** Model, time and cost of the subtask's session, as the run recorded them; a missing part is said, not guessed. */
function Metrics({ metrics }: { metrics: SubtaskMetrics }) {
  const { t } = useTranslation("workflow");
  return (
    <p className="subtask-metrics" aria-label={t("subtasks.metricsLabel")}>
      <span>{metrics.model ? <code>{metrics.model}</code> : t("subtasks.noModel")}</span>
      {metrics.durationMs !== undefined && <span>{formatDuration(metrics.durationMs)}</span>}
      <span>{metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(2)}` : t("subtasks.noCost")}</span>
      {metrics.inputTokens !== undefined && <span>{t("subtasks.inputTokens", { count: metrics.inputTokens })}</span>}
      {metrics.outputTokens !== undefined && <span>{t("subtasks.outputTokens", { count: metrics.outputTokens })}</span>}
    </p>
  );
}

/** The subtasks the plan's table gives, shown at the gate so the reviewer sees what approving starts. */
export function AssignmentPreview(props: { assignments: ParsedAssignments; parallel: number; maxSubtasks?: number }) {
  const { t } = useTranslation("workflow");
  const { items, errors } = props.assignments;
  return (
    <section className="subtask-preview" aria-label={t("subtasks.previewLabel")}>
      <h4>
        {props.maxSubtasks !== undefined
          ? t("subtasks.previewTitleLimited", { count: items.length, max: props.maxSubtasks, parallel: props.parallel })
          : t("subtasks.previewTitle", { count: items.length, parallel: props.parallel })}
      </h4>
      {errors.length > 0 ? (
        <div className="error" role="alert">
          <p>{t("subtasks.invalid")}</p>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="subtask-list">
          {items.map((a) => (
            <li key={a.n} className="subtask-row">
              <PreviewRow item={a} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PreviewRow({ item }: { item: Assignment }) {
  const { t } = useTranslation("workflow");
  return (
    <>
      <span className="subtask-n">{item.n}</span>
      <div className="subtask-main">
        <p className="subtask-title">
          {item.title} <AgentBadge agent={item.agent} />
        </p>
        <p className="subtask-meta">
          <RunAs item={item} />
          {item.files.length > 0 && <code>{item.files.join(", ")}</code>}
          {item.deps.length > 0 && <span>{t("subtasks.after", { list: AFTER(item.deps) })}</span>}
        </p>
      </div>
    </>
  );
}

interface TreeProps {
  taskKey: string;
  run: RunState;
  stepId: string;
  usage?: Record<number, MetricsSummary>;
  subtasks: SubtaskRun[];
  questions: Record<number, Question[]>;
  /** Sessions currently asking for a permission, by session id. */
  asking: Set<string>;
  onOpenTerminal: (sessionId: string) => void;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
  onHandoff: (target: HandoffTarget) => void;
}

/** The subtasks of a running dispatch step: each in its own session, answered and retried on its own. */
export function SubtaskTree(props: TreeProps) {
  const { t } = useTranslation("workflow");
  const done = props.subtasks.filter((s) => s.phase === "done").length;
  return (
    <div className="subtask-tree">
      <p className="subtask-progress">{t("subtasks.progress", { done, total: props.subtasks.length })}</p>
      <ol className="subtask-list">
        {props.subtasks.map((s) => (
          <li key={s.n} className={`subtask-row phase-${s.phase}`}>
            <SubtaskRow {...props} sub={s} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function SubtaskRow(props: TreeProps & { sub: SubtaskRun }) {
  const { t } = useTranslation("workflow");
  const { sub } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = { kind: "subtask" as const, stepId: props.stepId, n: sub.n };
  const override = Object.values(props.run.laneOverrides ?? {}).find((item) => item.scope.kind === "subtask" && item.scope.stepId === props.stepId && item.scope.n === sub.n);
  const effective = props.run.attempts?.findLast((a) => a.sessionId === sub.sessionId)?.execution ?? (override ? { ...override.execution, subagent: undefined } : sub);
  const blocked = isLaneBlocked(props.run, scope, sub);
  const permission = sub.sessionId !== undefined && props.asking.has(sub.sessionId);
  const questions = props.questions[sub.n] ?? [];

  const retry = async () => {
    setBusy(true);
    try {
      await workflowApi.retrySubtask(props.taskKey, sub.n);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      props.onChanged();
    }
  };

  return (
    <>
      <span className="subtask-n" aria-hidden="true">
        {sub.phase === "done" ? <CheckCircle weight="fill" /> : sub.phase === "interrupted" ? <PlugsConnected weight="fill" /> : sub.phase === "pending" ? <Circle /> : sub.n}
      </span>
      <div className="subtask-main">
        <p className="subtask-title">
          <span className="subtask-num">{sub.n}.</span> {sub.title} <AgentBadge agent={effective.agent} />
          {!blocked && sub.noHook && sub.phase !== "done" && <span className="subtask-nohook">{t("subtasks.noHook", { agent: PROVIDER_LABELS[effective.agent] })}</span>}
          <span className={`subtask-phase phase-${sub.phase}`}>{permission ? t("subtasks.permission") : t(`subtasks.phase.${sub.phase}`)}</span>
        </p>
        <p className="subtask-meta">
          <RunAs item={{ ...sub, agent: effective.agent, model: effective.model, subagent: effective.subagent }} />
          {sub.files.length > 0 && <code>{sub.files.join(", ")}</code>}
          {sub.deps.length > 0 && <span>{t("subtasks.after", { list: AFTER(sub.deps) })}</span>}
        </p>
        {props.usage?.[sub.n] ? (
          <UsageSummary usage={props.usage[sub.n]} />
        ) : (
          sub.metrics && (
            <>
              <p className="now-sub">{t("handoff.sources.legacy")}</p>
              <Metrics metrics={sub.metrics} />
            </>
          )
        )}
        {!blocked && sub.phase === "waiting" && (
          <ReplyForm send={(text) => workflowApi.replySubtask(props.taskKey, sub.n, text)} questions={questions} agent={PROVIDER_LABELS[effective.agent]} onChanged={props.onChanged} />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {sub.sessionId && sub.phase !== "done" && sub.phase !== "pending" && (
          <QuotaNotice
            taskKey={props.taskKey}
            sessionId={sub.sessionId}
            unknown={sub.phase === "interrupted" || !!sub.noHook}
            disabled={blocked || busy}
            onRetry={() => void retry()}
            onHandoff={(agent) => props.onHandoff({ scope, execution: agent ? { agent } : effective, sub })}
          />
        )}
        <div className="subtask-actions">
          <HandoffAction taskKey={props.taskKey} run={props.run} scope={scope} execution={effective} sub={sub} onChanged={props.onChanged} onRequest={props.onHandoff} />
          {sub.phase === "done" && (
            <Button icon={FileText} variant="quiet" onClick={() => props.onOpenDoc(sub.report)}>
              {t("subtasks.readReport", { file: sub.report })}
            </Button>
          )}
          {!blocked && permission && (
            <Button icon={HandPalm} variant="attention" onClick={() => props.onOpenTerminal(sub.sessionId!)}>
              {t("now.permissionAnswer")}
            </Button>
          )}
          {sub.sessionId && sub.phase !== "done" && !permission && (
            <Button icon={TerminalWindow} variant="quiet" onClick={() => props.onOpenTerminal(sub.sessionId!)}>
              {t("now.openTerminal")}
            </Button>
          )}
          {!blocked && sub.noHook && (sub.phase === "running" || sub.phase === "waiting") && (
            <MarkDoneButton complete={() => workflowApi.completeSubtask(props.taskKey, sub.n)} onChanged={props.onChanged} onError={setError} />
          )}
          {sub.phase === "interrupted" && (
            <Button icon={ArrowClockwise} variant="attention" busy={busy} disabled={blocked} onClick={() => void retry()}>
              {t("subtasks.retry")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/** Suggestions only open the existing preview dialog. Dismissal never mutates a run/session. */
export function QuotaNotice(props: { taskKey: string; sessionId: string; unknown: boolean; disabled: boolean; onRetry: () => void; onHandoff: (agent?: "codex") => void }) {
  const { t } = useTranslation("workflow");
  const { repo } = useWorkspace();
  const { sessions } = useSessions(props.taskKey);
  useInvalidateOnEvent("usage", ["sessions", props.taskKey]);
  const session = sessions.find((item) => item.id === props.sessionId);
  const failure = session?.failure;
  const account = session?.accountQuota;
  const [now, setNow] = useState(Date.now);
  const validUntil = account?.validUntil ?? (account ? account.observedAt + 5 * 60_000 : 0);
  useEffect(() => {
    const refresh = setTimeout(() => setNow(Date.now()), 0);
    const expiry = validUntil > Date.now() ? setTimeout(() => setNow(Date.now()), validUntil - Date.now() + 1) : undefined;
    return () => {
      clearTimeout(refresh);
      clearTimeout(expiry);
    };
  }, [validUntil, account?.observedAt]);
  const accountFresh = account?.freshness === "fresh" && now >= account.observedAt && now <= validUntil;
  const quota = failure?.reason === "quota" || (!!accountFresh && !!account?.exhausted);
  const capabilities = useAgentCapabilities(quota);
  const codex = capabilities.data?.agents.find((item) => item.agent === "codex");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const identity = `${repo?.path}:${props.sessionId}:${failure?.observedAt ?? ""}:${account?.observedAt ?? ""}`;
  if (!session || session.retired || session.reservation || dismissed === identity || (!failure && !props.unknown && !quota)) return null;
  return (
    <div role="status" aria-label={t("quota.label")}>
      {(failure || props.unknown) && <p className="now-sub">{t(`quota.reasons.${failure?.reason ?? "unknown"}`)}</p>}
      {failure && <p className="now-sub">{t("quota.turnTime", { time: new Date(failure.observedAt).toLocaleString() })}</p>}
      {account && (
        <p className="now-sub">
          {t("quota.account", {
            time: new Date(account.observedAt).toLocaleString(),
            source: t(`quota.sources.${account.source}`),
            freshness: t(accountFresh ? "quota.fresh" : "quota.stale"),
          })}
        </p>
      )}
      {quota && (
        <div className="now-actions">
          <Button disabled={props.disabled} onClick={props.onRetry}>
            {t("quota.retry")}
          </Button>
          {session.agent !== "codex" && codex?.cli.status === "supported" && codex.login.status === "supported" && (
            <Button disabled={props.disabled} onClick={() => props.onHandoff("codex")}>
              {t("quota.codex")}
            </Button>
          )}
          <Button disabled={props.disabled} onClick={() => props.onHandoff()}>
            {t("quota.choose")}
          </Button>
          <Button variant="quiet" onClick={() => setDismissed(identity)}>
            {t("quota.later")}
          </Button>
        </div>
      )}
    </div>
  );
}
