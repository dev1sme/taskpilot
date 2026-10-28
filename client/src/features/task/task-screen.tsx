import type { RunView, TaskListItem } from "@server/api-types";
import { ArrowUUpLeft, CaretDown, CheckCircle, ChatCircleDots, CircleNotch, Diamond, DotsThreeVertical, PlugsConnected, Scroll, X, type Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
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
import { refreshTask, useRun, workflowApi } from "@/features/workflow/queries";
import { Stepper } from "@/features/workflow/stepper";
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
  const { t } = useTranslation("task");
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

  return (
    <div className="flex min-h-full flex-col">
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
              <section className="rounded-md border border-dashed border-line p-4 text-sm text-muted">{t("pendingNow")}</section>
            </div>
            <aside className="grid content-start gap-6">
              <DocsPanel task={task} steps={steps} reports={run?.subtasks?.map((s) => s.report)} onOpen={setDoc} />
              <ActivityFeed items={activity} />
            </aside>
          </div>

          <WorkflowSource view={view} />
        </div>
      )}

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
