import { ArrowClockwise, CheckCircle, Circle, FileText, HandPalm, PlugsConnected, TerminalWindow } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AGENT_LABELS } from "../../shared/agents";
import { AgentBadge } from "../../shared/ui/AgentBadge";
import { Button } from "../../shared/ui/Button";
import { formatDuration } from "../../shared/ui/Elapsed";
import { workflowApi } from "./api";
import { MarkDoneButton } from "./MarkDoneButton";
import { ReplyForm } from "./ReplyForm";
import type { Assignment, ParsedAssignments, Question, SubtaskMetrics, SubtaskRun } from "./types";
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
    </p>
  );
}

/** The subtasks the plan's table gives, shown at the gate so the reviewer sees what approving starts. */
export function AssignmentPreview(props: { assignments: ParsedAssignments; parallel: number }) {
  const { t } = useTranslation("workflow");
  const { items, errors } = props.assignments;
  return (
    <section className="subtask-preview" aria-label={t("subtasks.previewLabel")}>
      <h4>{t("subtasks.previewTitle", { count: items.length, parallel: props.parallel })}</h4>
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
  subtasks: SubtaskRun[];
  questions: Record<number, Question[]>;
  /** Sessions currently asking for a permission, by session id. */
  asking: Set<string>;
  onOpenTerminal: (sessionId: string) => void;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
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
          <span className="subtask-num">{sub.n}.</span> {sub.title} <AgentBadge agent={sub.agent} />
          {sub.noHook && sub.phase !== "done" && <span className="subtask-nohook">{t("subtasks.noHook", { agent: AGENT_LABELS[sub.agent] })}</span>}
          <span className={`subtask-phase phase-${sub.phase}`}>{permission ? t("subtasks.permission") : t(`subtasks.phase.${sub.phase}`)}</span>
        </p>
        <p className="subtask-meta">
          <RunAs item={sub} />
          {sub.files.length > 0 && <code>{sub.files.join(", ")}</code>}
          {sub.deps.length > 0 && <span>{t("subtasks.after", { list: AFTER(sub.deps) })}</span>}
        </p>
        {sub.metrics && <Metrics metrics={sub.metrics} />}
        {sub.phase === "waiting" && (
          <ReplyForm send={(text) => workflowApi.replySubtask(props.taskKey, sub.n, text)} questions={questions} agent={AGENT_LABELS[sub.agent]} onChanged={props.onChanged} />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="subtask-actions">
          {sub.phase === "done" && (
            <Button icon={FileText} variant="quiet" onClick={() => props.onOpenDoc(sub.report)}>
              {t("subtasks.readReport", { file: sub.report })}
            </Button>
          )}
          {permission && (
            <Button icon={HandPalm} variant="attention" onClick={() => props.onOpenTerminal(sub.sessionId!)}>
              {t("now.permissionAnswer")}
            </Button>
          )}
          {sub.sessionId && sub.phase !== "done" && !permission && (
            <Button icon={TerminalWindow} variant="quiet" onClick={() => props.onOpenTerminal(sub.sessionId!)}>
              {t("now.openTerminal")}
            </Button>
          )}
          {sub.noHook && (sub.phase === "running" || sub.phase === "waiting") && (
            <MarkDoneButton complete={() => workflowApi.completeSubtask(props.taskKey, sub.n)} onChanged={props.onChanged} onError={setError} />
          )}
          {sub.phase === "interrupted" && (
            <Button icon={ArrowClockwise} variant="attention" busy={busy} onClick={() => void retry()}>
              {t("subtasks.retry")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
