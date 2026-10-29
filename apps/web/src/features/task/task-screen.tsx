import type { RunView, TaskListItem } from "@taskpilot/server/api-types";
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  CaretDown,
  CheckCircle,
  ChatCircleDots,
  CircleNotch,
  Diamond,
  DotsThreeVertical,
  PlugsConnected,
  Scroll,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { Link, useParams } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActivityFeed, useActivity } from "@/features/activity/activity-feed";
import { DocViewer, TextViewer } from "@/features/docs/doc-viewer";
import { DocsPanel } from "@/features/docs/docs-panel";
import { useSetTaskDone } from "@/features/tasks/queries";
import { ACTIVE_PHASES, type RunPhase } from "@/features/tasks/status";
import { refreshTask, useRun, workflowApi, type RunOptions as RunOptionsValue } from "@/features/workflow/queries";
import { GateCard } from "@/features/workflow/gate-card";
import { HandoffDialog, RunHistory, type HandoffTarget } from "@/features/workflow/handoff";
import { NowCard } from "@/features/workflow/now-card";
import { RunOptions } from "@/features/workflow/run-options";
import { WorkspacePanel } from "@/features/workflow/workspace-card";
import { Stepper } from "@/features/workflow/stepper";
import { sessionsApi, useSessions } from "@/features/sessions/queries";
import { TerminalDrawer } from "@/features/sessions/terminal-drawer";
import { useRepo, useTasks } from "@/features/workspace/queries";
import { locale } from "@/i18n";
import { cn } from "@/lib/utils";

type BadgePhase = Exclude<RunPhase, "cancelled">;
const PHASE: Record<BadgePhase, { tone: "signal" | "attention" | "done"; icon: Icon }> = {
  starting: { tone: "signal", icon: CircleNotch },
  running: { tone: "signal", icon: CircleNotch },
  waiting: { tone: "attention", icon: ChatCircleDots },
  gate: { tone: "attention", icon: Diamond },
  interrupted: { tone: "attention", icon: PlugsConnected },
  done: { tone: "done", icon: CheckCircle },
};

/** One task: what is happening now (or the review), progress, documents and activity. */
/** /tasks/$key. */
export function TaskRoute() {
  const { key } = useParams({ from: "/tasks/$key" });
  return <TaskScreen taskKey={key} />;
}

export function TaskScreen({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation("task");
  const tasks = useTasks();
  const repo = useRepo().data;
  const task = tasks.data?.find((x) => x.key === taskKey);
  if (!task) {
    if (tasks.isPending) return null;
    return (
      <EmptyState
        title={t("notFoundTitle", { key: taskKey })}
        action={
          <Button asChild variant="secondary">
            <Link to="/tasks">{t("backToTasks")}</Link>
          </Button>
        }
      >
        {t("notFoundBody")}
      </EmptyState>
    );
  }
  // A repo switch or another task starts every per-task state afresh.
  return <TaskContent key={`${repo?.path}:${task.key}`} task={task} />;
}

function TaskContent({ task }: { task: TaskListItem }) {
  const { t } = useTranslation(["task", "sessions"]);
  const viewQuery = useRun(task.key);
  const view = viewQuery.data;
  const activity = useActivity(task.key);
  const [doc, setDoc] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const closeDoc = useCallback(() => setDoc(null), []);

  const run = view?.run ?? null;
  const steps = view?.workflow.steps ?? [];
  const active = run !== null && (ACTIVE_PHASES as readonly string[]).includes(run.phase);
  const sent = run?.sentPrompt;
  const badgePhase: BadgePhase | undefined = run && active ? (run.phase as BadgePhase) : task.done ? "done" : undefined;
  const current = run ? steps[run.stepIndex] : undefined;
  const next = run ? steps[run.stepIndex + 1] : undefined;
  const sessions = useSessions(task.key).data ?? [];
  const [handoff, setHandoff] = useState<HandoffTarget | null>(null);
  const runSession = sessions.find((s) => s.id === run?.sessionId) ?? null;
  // A session replaced by a committed handoff no longer speaks for its lane.
  const replaced = new Set(run?.handoffs?.filter((op) => op.stage === "committed").map((op) => op.sourceSessionId));
  const asking = new Set(sessions.filter((s) => s.activity === "permission" && !s.retired && !s.reservation && !replaced.has(s.id)).map((s) => s.id));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  // A session asking for permission comes to the front. The seen states start null, so the first render counts as a change.
  const firstAsking = [...asking][0];
  const [seenAsking, setSeenAsking] = useState<string | undefined | null>(null);
  if (seenAsking !== firstAsking) {
    setSeenAsking(firstAsking);
    if (firstAsking) {
      setActiveSession(firstAsking);
      setDrawerOpen(true);
    }
  }
  // The run's session is the default tab; a handoff's new session opens by itself.
  const runSessionId = run?.sessionId;
  const [seenRunSession, setSeenRunSession] = useState<string | undefined | null>(null);
  if (seenRunSession !== runSessionId) {
    setSeenRunSession(runSessionId);
    if (runSessionId && !firstAsking) {
      setActiveSession(runSessionId);
      if (run?.handoffs?.some((op) => op.stage === "committed" && op.targetSessionId === runSessionId)) setDrawerOpen(true);
    }
  }
  const openSession = (id?: string) => {
    const target = id ?? run?.sessionId;
    if (target) setActiveSession(target);
    setDrawerOpen(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <header className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/tasks" className="font-mono text-xs text-muted hover:text-ink">
                {task.key}
              </Link>
              {badgePhase && <PhaseBadge phase={badgePhase} doneAt={task.done?.at ?? null} working={run?.phase === "running" || run?.phase === "starting"} />}
            </div>
            {task.title !== task.key && <h1 className="line-clamp-2 text-base font-semibold sm:text-lg">{task.title}</h1>}
          </div>
          {view && <TaskTools task={task} view={view} active={active} onShowPrompt={sent ? () => setShowPrompt(true) : undefined} />}
        </header>

        {viewQuery.error && (
          <p role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger sm:px-6">
            {viewQuery.error.message}
          </p>
        )}

        {view && (
          <div className="grid gap-4 px-4 py-4 sm:px-6">
            <details className="group rounded-md border border-line bg-surface md:open:bg-surface" open>
              <summary className="flex min-h-10 items-center gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{t("progress")}</span>
                <span className="truncate text-muted">{current ? `${run!.stepIndex + 1}/${steps.length} · ${current.title}` : t("progressAll", { total: steps.length })}</span>
                <CaretDown className="ml-auto size-4 text-faint transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-line px-3 py-3">
                <Stepper steps={steps} run={run} />
              </div>
            </details>

            <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]", run?.phase === "gate" && "xl:grid-cols-[minmax(0,1fr)_22rem]")}>
              <div className="grid min-w-0 content-start gap-4">
                {run?.phase === "gate" && current ? (
                  <GateCard
                    taskKey={task.key}
                    run={run}
                    step={current}
                    questions={view.questions}
                    assignments={next?.dispatch ? view.assignments : null}
                    parallel={next?.dispatch?.parallel ?? 1}
                    maxSubtasks={next?.dispatch?.maxSubtasks}
                    isLast={run.stepIndex === steps.length - 1}
                    docVersion={task.updatedAt}
                    onOpenDoc={setDoc}
                  />
                ) : (
                  <NowCard
                    taskKey={task.key}
                    view={view}
                    run={run}
                    session={runSession}
                    activity={activity}
                    asking={asking}
                    onOpenSession={openSession}
                    onOpenDoc={setDoc}
                    onHandoff={setHandoff}
                  />
                )}
                <WorkspacePanel taskKey={task.key} />
                {run && <RunHistory run={run} usage={view.usage} onOpenSession={openSession} />}
              </div>
              <aside className="grid content-start gap-6">
                <DocsPanel task={task} steps={steps} reports={run?.subtasks?.map((s) => s.report)} onOpen={setDoc} />
                <ActivityFeed items={activity} />
              </aside>
            </div>

            <WorkflowSource view={view} />
          </div>
        )}
      </div>
      <TerminalDrawer
        label={t("sessions:terminal")}
        scope="task"
        emptyHint={t("terminalEmpty")}
        onCreate={(agent) => sessionsApi.create(task.key, agent)}
        sessions={sessions}
        activeId={activeSession}
        open={drawerOpen}
        runSessionIds={active && run ? [run.sessionId, ...(run.subtasks ?? []).flatMap((s) => (s.sessionId ? [s.sessionId] : []))] : []}
        onSelect={setActiveSession}
        onToggle={setDrawerOpen}
        onChanged={() => void refreshTask(task.key)}
      />

      <HandoffDialog taskKey={task.key} target={handoff} onClose={() => setHandoff(null)} />
      <DocViewer taskKey={task.key} path={doc} version={task.updatedAt} onClose={closeDoc} />
      <TextViewer
        title={showPrompt && sent ? t("sentPromptHead", { step: steps[sent.stepIndex]?.title ?? sent.stepIndex + 1, time: new Date(sent.at).toLocaleString(locale()) }) : null}
        text={sent?.text ?? ""}
        onClose={() => setShowPrompt(false)}
      />
    </div>
  );
}

function PhaseBadge({ phase, doneAt, working }: { phase: BadgePhase; doneAt: number | null; working: boolean }) {
  const { t } = useTranslation("task");
  const { tone, icon: PhaseIcon } = PHASE[phase];
  return (
    <Badge tone={tone} title={phase === "done" && doneAt ? t("doneAt", { time: new Date(doneAt).toLocaleString(locale()) }) : undefined}>
      <PhaseIcon weight={tone === "signal" ? "bold" : "fill"} className={working ? "animate-spin" : undefined} aria-hidden />
      {t(`phase.${phase}`)}
    </Badge>
  );
}

/** Rare and destructive actions sit in one menu, away from the current decision. */
function TaskTools({ task, view, active, onShowPrompt }: { task: TaskListItem; view: RunView; active: boolean; onShowPrompt?: () => void }) {
  const { t } = useTranslation(["task", "common"]);
  const setDone = useSetTaskDone();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const run = view.run;
  // Interrupted, finished and cancelled runs offer the restart in their card already.
  const canRestart = run !== null && !["interrupted", "done", "cancelled"].includes(run.phase);
  const restart = async (options: RunOptionsValue) => {
    setRestartBusy(true);
    try {
      await workflowApi.restart(task.key, options);
      await refreshTask(task.key);
      setRestarting(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestartBusy(false);
    }
  };
  const [cancelling, setCancelling] = useState(false);
  const cancel = async () => {
    setCancelling(true);
    try {
      await workflowApi.cancel(task.key);
      await refreshTask(task.key);
      setConfirmCancel(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };
  const markDone = (done: boolean) => setDone.mutate({ key: task.key, done }, { onError: (e) => toast.error(e.message) });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" busy={setDone.isPending}>
            <DotsThreeVertical weight="bold" aria-hidden />
            {t("tools")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onShowPrompt && (
            <DropdownMenuItem onSelect={onShowPrompt}>
              <Scroll aria-hidden />
              {t("sentPrompt")}
            </DropdownMenuItem>
          )}
          {!active &&
            view &&
            (task.done ? (
              <DropdownMenuItem onSelect={() => markDone(false)}>
                <ArrowUUpLeft aria-hidden />
                {t("reopen")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => markDone(true)}>
                <CheckCircle aria-hidden />
                {t("markDone")}
              </DropdownMenuItem>
            ))}
          {canRestart && (
            <DropdownMenuItem onSelect={() => setRestarting(true)}>
              <ArrowCounterClockwise aria-hidden />
              {t("restart")}
            </DropdownMenuItem>
          )}
          {active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => setConfirmCancel(true)}>
                <X aria-hidden />
                {t("cancelTitle")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={restarting} onOpenChange={(open) => !restartBusy && setRestarting(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("restartTitle")}</DialogTitle>
            <DialogDescription>{t("restartHint")}</DialogDescription>
          </DialogHeader>
          {run && (
            <RunOptions
              taskKey={task.key}
              initial={{ mode: view.runMode?.id ?? view.workflow.mode.id, execution: run.execution ?? { agent: "workflow" }, ...(run.workspace ? { isolation: "worktree" as const } : {}) }}
              disabled={restartBusy}
            >
              {(options, blocked) => (
                <Button variant="attention" busy={restartBusy} disabled={blocked} onClick={() => void restart(options)}>
                  <ArrowCounterClockwise aria-hidden />
                  {t("restartConfirm")}
                </Button>
              )}
            </RunOptions>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelConfirmTitle", { key: task.key })}</DialogTitle>
            <DialogDescription>{t("cancelConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("cancelKeep")}</Button>
            </DialogClose>
            <Button variant="danger" busy={cancelling} onClick={() => void cancel()}>
              <X aria-hidden />
              {t("cancelTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkflowSource({ view }: { view: RunView }) {
  const { t } = useTranslation("task");
  const mode = view.workflow.mode;
  const source = mode ? (mode.override ? t("sourceModeOverride", { name: mode.name }) : mode.name) : view.workflow.origin === "repo" ? t("sourceRepo") : t("sourceDefault");
  return (
    <p className="text-xs text-faint" title={view.workflow.source}>
      <Link to="/config/$section" params={{ section: "workflow" }} search={{}} className="hover:text-ink hover:underline">
        {t("source", { source })}
      </Link>
      {view.workflow.outdated && <span> · {t("outdated")}</span>}
    </p>
  );
}
