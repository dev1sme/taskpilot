import type { ActivityItem, RunState, RunView, SessionView } from "@server/api-types";
import { ArrowClockwise, ArrowCounterClockwise, ChatCircleDots, CheckCircle, FileText, HandPalm, Play, PlugsConnected, TerminalWindow } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Elapsed } from "@/components/elapsed";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/providers";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ReplyForm } from "./answers";
import { HandoffAction, isLaneBlocked, type HandoffTarget } from "./handoff";
import { MarkDoneButton } from "./mark-done";
import { refreshTask, workflowApi, type RunOptions as RunOptionsValue } from "./queries";
import { RunOptions } from "./run-options";
import { QuotaNotice, SubtaskTree } from "./subtasks";

type Step = RunView["workflow"]["steps"][number];
type Tone = "signal" | "attention" | "done" | "idle";

interface Props {
  taskKey: string;
  view: RunView;
  run: RunState | null;
  session: SessionView | null;
  activity: ActivityItem[];
  /** Sessions asking for a permission. */
  asking: Set<string>;
  onOpenSession?: (sessionId?: string) => void;
  onOpenDoc: (path: string) => void;
  onHandoff: (target: HandoffTarget) => void;
}

const TONE: Record<Tone, string> = {
  signal: "border-line bg-surface",
  attention: "border-attention-line bg-attention-soft/40",
  done: "border-line bg-surface",
  idle: "border-line bg-surface",
};

function Card({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }) {
  const { t } = useTranslation("workflow");
  return (
    <section aria-label={t("now.label")} className={cn("grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-md border p-4", TONE[tone])}>
      <span
        aria-hidden
        className={cn(
          "grid size-8 place-items-center rounded-sm [&_svg]:size-4",
          tone === "attention" ? "bg-attention text-on-attention" : tone === "done" ? "bg-done-soft text-done" : tone === "signal" ? "bg-signal-soft text-signal" : "bg-sunken text-muted",
        )}
      >
        {icon}
      </span>
      <div className="grid min-w-0 gap-3">{children}</div>
    </section>
  );
}

function Title({ children, since }: { children: ReactNode; since?: number }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {since !== undefined && <Elapsed since={since} className="font-mono text-xs text-muted" />}
    </div>
  );
}

const Text = ({ children }: { children: ReactNode }) => <p className="text-sm">{children}</p>;
const Actions = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

/** What is happening right now and what the user can do about it; gates use GateCard instead. */
export function NowCard({ taskKey, view, run, session, activity, asking, onOpenSession, onOpenDoc, onHandoff }: Props) {
  const { t } = useTranslation("workflow");
  const [busy, setBusy] = useState(false);
  const steps = view.workflow.steps;
  const mode = view.runMode?.id ?? view.workflow.mode.id;
  const initial: RunOptionsValue | undefined = run ? { mode, execution: run.execution ?? { agent: "workflow" } } : undefined;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      void refreshTask(taskKey);
    }
  };

  const step: Step | undefined = run ? steps[run.stepIndex] : undefined;
  const scope = step ? { kind: "step" as const, stepId: step.id } : undefined;
  const blocked = Boolean(run && scope && isLaneBlocked(run, scope));
  const agent = PROVIDER_LABELS[(step ?? steps[0])?.effective.agent ?? "claude"];
  const handoffTarget: HandoffTarget | undefined = step && scope && !step.dispatch ? { scope, execution: step.effective } : undefined;
  const handoff = run && handoffTarget && <HandoffAction run={run} target={handoffTarget} onRequest={onHandoff} />;
  const retry = (
    <Button variant={run?.phase === "interrupted" ? "attention" : "ghost"} busy={busy} disabled={blocked} onClick={() => void act(() => workflowApi.retry(taskKey))}>
      <ArrowClockwise aria-hidden />
      {t("now.retry")}
    </Button>
  );
  const terminal = onOpenSession && (
    <Button onClick={() => onOpenSession()}>
      <TerminalWindow aria-hidden />
      {t("now.openTerminal")}
    </Button>
  );
  const markDone = !blocked && run?.noHook && step?.doneFile && <MarkDoneButton complete={() => workflowApi.completeStep(taskKey)} onDone={() => void refreshTask(taskKey)} />;
  const restart = (
    <details className="w-full">
      <summary className="text-sm text-signal-text">{t("now.restartOptions")}</summary>
      <div className="mt-3">
        <RunOptions taskKey={taskKey} initial={initial} disabled={busy}>
          {(options, optionsBlocked) => (
            <Button variant="ghost" busy={busy} disabled={optionsBlocked} onClick={() => void act(() => workflowApi.restart(taskKey, options))}>
              <ArrowCounterClockwise aria-hidden />
              {t("now.restart")}
            </Button>
          )}
        </RunOptions>
      </div>
    </details>
  );
  const effective = run && step && (
    <>
      <p className="text-xs text-muted">{t("selection.effective", { agent, model: step.effective.model ?? t("selection.defaultModel") })}</p>
      {run.sessionId && scope && !step.dispatch && ["starting", "running", "waiting", "interrupted"].includes(run.phase) && (
        <QuotaNotice
          taskKey={taskKey}
          sessionId={run.sessionId}
          unknown={run.phase === "interrupted" || Boolean(run.noHook)}
          disabled={blocked || busy}
          onRetry={() => void act(() => workflowApi.retry(taskKey))}
          onHandoff={(next) => handoffTarget && onHandoff(next ? { ...handoffTarget, execution: { agent: next } } : handoffTarget)}
        />
      )}
    </>
  );

  // Not started, finished or cancelled: offer to (re)start.
  if (!run || run.phase === "done" || run.phase === "cancelled") {
    const done = run?.phase === "done";
    const lastDoc = [...steps].reverse().find((s) => s.doneFile)?.doneFile;
    return (
      <Card tone={done ? "done" : "idle"} icon={done ? <CheckCircle weight="fill" /> : <Play weight="fill" />}>
        <Title>{done ? t("now.doneTitle") : run ? t("now.cancelledTitle") : t("now.readyTitle")}</Title>
        <Text>
          {done ? <Trans t={t} i18nKey="now.doneBody" values={{ duration: formatDuration(run.updatedAt - run.startedAt) }} components={{ strong: <strong /> }} /> : t("selection.readyBody")}
        </Text>
        {done && lastDoc && (
          <Actions>
            <Button variant="primary" onClick={() => onOpenDoc(lastDoc)}>
              <FileText aria-hidden />
              {t("now.readDoc", { file: lastDoc })}
            </Button>
          </Actions>
        )}
        <RunOptions taskKey={taskKey} initial={initial} disabled={busy}>
          {(options, optionsBlocked) => (
            <Button
              variant={done ? "secondary" : "primary"}
              size={done ? "md" : "lg"}
              busy={busy}
              disabled={optionsBlocked}
              onClick={() => void act(() => (run ? workflowApi.restart(taskKey, options) : workflowApi.start(taskKey, options)))}
            >
              <Play weight="fill" aria-hidden />
              {run ? t("now.restart") : t("now.start")}
            </Button>
          )}
        </RunOptions>
      </Card>
    );
  }

  // The leader's session is idle while its subtasks work: each one is shown and answered on its own.
  if (step?.dispatch && run.subtasks) {
    const done = run.subtasks.filter((s) => s.phase === "done").length;
    const attention = run.phase === "waiting" || run.phase === "interrupted" || run.subtasks.some((s) => asking.has(s.sessionId ?? ""));
    return (
      <Card tone={attention ? "attention" : "signal"} icon={attention ? <ChatCircleDots weight="fill" /> : <span className="size-2.5 animate-pulse rounded-full bg-signal" />}>
        <Title since={run.stepStartedAt}>{t("subtasks.title", { step: step.title, done, total: run.subtasks.length })}</Title>
        {run.message && <Text>{run.message}</Text>}
        {effective}
        <SubtaskTree
          taskKey={taskKey}
          run={run}
          stepId={step.id}
          usage={view.subtaskUsage}
          questions={view.subtaskQuestions}
          asking={asking}
          onOpenSession={onOpenSession}
          onOpenDoc={onOpenDoc}
          onHandoff={onHandoff}
        />
        <Actions>{restart}</Actions>
      </Card>
    );
  }

  if (blocked) {
    return (
      <Card tone="attention" icon={<PlugsConnected weight="fill" />}>
        <Title>{t("handoff.blocked")}</Title>
        {effective}
        {run.message && <Text>{run.message}</Text>}
        <Actions>
          {terminal}
          {handoff}
        </Actions>
      </Card>
    );
  }

  if (session?.activity === "permission") {
    const ask = [...activity].reverse().find((i) => i.kind === "permission");
    return (
      <Card tone="attention" icon={<HandPalm weight="fill" />}>
        <Title>{t("now.permissionTitle", { agent })}</Title>
        {effective}
        <Text>{ask?.action ?? t("now.permissionFallback", { agent })}</Text>
        <p className="text-xs text-muted">{t("now.permissionHint")}</p>
        <Actions>
          {onOpenSession && (
            <Button variant="attention" onClick={() => onOpenSession()}>
              <TerminalWindow aria-hidden />
              {t("now.permissionAnswer")}
            </Button>
          )}
          {handoff}
        </Actions>
      </Card>
    );
  }

  if (run.phase === "waiting") {
    return (
      <Card tone="attention" icon={<ChatCircleDots weight="fill" />}>
        <Title>{t("now.waitingTitle", { agent })}</Title>
        {effective}
        {run.message && <Text>{run.message}</Text>}
        {run.lastMessage && view.questions.length === 0 && <blockquote className="border-l-2 border-line-strong pl-3 text-sm text-muted">{lastParagraph(run.lastMessage)}</blockquote>}
        <ReplyForm send={(text) => workflowApi.reply(taskKey, text)} questions={view.questions} agent={agent} onSent={() => void refreshTask(taskKey)} />
        <Actions>
          {terminal}
          {markDone}
          {retry}
          {handoff}
        </Actions>
      </Card>
    );
  }

  if (run.phase === "interrupted") {
    return (
      <Card tone="attention" icon={<PlugsConnected weight="fill" />}>
        <Title>{t("now.interruptedTitle", { step: step?.title })}</Title>
        {effective}
        {run.message && <Text>{run.message}</Text>}
        <Actions>
          {retry}
          {handoff}
          {restart}
        </Actions>
      </Card>
    );
  }

  // starting / running
  const current = currentTool(activity, run.stepStartedAt);
  const counts = countSince(activity, run.stepStartedAt);
  return (
    <Card tone="signal" icon={<span className="size-2.5 animate-pulse rounded-full bg-signal" />}>
      <Title since={run.phase === "starting" ? run.updatedAt : run.stepStartedAt}>
        {run.phase === "starting" ? t("now.startingTitle", { agent }) : t("now.runningTitle", { agent, step: step?.title })}
      </Title>
      {effective}
      <p aria-live="polite" className="truncate text-sm">
        {current ? current.summary : run.phase === "starting" ? t("now.startingHint", { agent }) : t("now.thinking", { agent })}
      </p>
      {run.phase === "running" && (
        <ul aria-label={t("now.countsLabel")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted [&_strong]:font-mono [&_strong]:text-ink">
          {(["read", "write", "run"] as const).map((key) => (
            <li key={key}>
              <Trans t={t} i18nKey={`now.counts.${key}`} values={{ count: counts[key] }} components={{ strong: <strong /> }} />
            </li>
          ))}
          {counts.error > 0 && (
            <li className="text-danger">
              <Trans t={t} i18nKey="now.counts.error" values={{ count: counts.error }} components={{ strong: <strong /> }} />
            </li>
          )}
        </ul>
      )}
      <Actions>
        {terminal}
        {run.phase === "running" && markDone}
        {retry}
        {handoff}
      </Actions>
    </Card>
  );
}

function currentTool(items: ActivityItem[], since: number): ActivityItem | undefined {
  const recent = items.filter((i) => i.at >= since - 1000 && i.kind === "tool");
  return [...recent].reverse().find((i) => i.status === "running") ?? recent[recent.length - 1];
}

function countSince(items: ActivityItem[], since: number) {
  const c = { read: 0, write: 0, run: 0, error: 0 };
  for (const i of items) {
    if (i.kind !== "tool" || i.at < since - 1000) continue;
    if (i.status === "error") c.error++;
    if (i.category === "read") c.read++;
    else if (i.category === "write") c.write++;
    else if (i.category === "run") c.run++;
  }
  return c;
}

function lastParagraph(text: string): string {
  const parts = text.trim().split(/\n\s*\n/);
  const last = parts[parts.length - 1] ?? "";
  return last.length > 400 ? `${last.slice(0, 400)}…` : last;
}
