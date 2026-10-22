import { ArrowCounterClockwise, ArrowUUpLeft, CheckCircle, ChatCircleDots, CircleNotch, Diamond, PlugsConnected, Scroll, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { href } from "../../shared/router";
import { Button } from "../../shared/ui/Button";
import { ActivityFeed, useActivity } from "../activity";
import { DocsPanel, DocViewer, TextViewer } from "../docs";
import { TerminalDrawer, useSessions, sessionsApi } from "../sessions";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Toolbar } from "../../shared/ui/Toolbar";
import { GateCard, ModePicker, NowCard, Stepper, ACTIVE_PHASES, useRun, workflowApi } from "../workflow";
import { useTaskDone } from "../tasks";
import "./task.css";
import type { RunPhase, TaskSummary } from "../workspace";

type PillPhase = Exclude<RunPhase, "cancelled">;

/** Phases with a pill; the label is `task:phase.<phase>`. */
const PHASE_PILL: Record<PillPhase, { tone: string; icon: typeof CheckCircle }> = {
  starting: { tone: "signal", icon: CircleNotch },
  running: { tone: "signal", icon: CircleNotch },
  waiting: { tone: "attention", icon: ChatCircleDots },
  gate: { tone: "attention", icon: Diamond },
  interrupted: { tone: "attention", icon: PlugsConnected },
  done: { tone: "done", icon: CheckCircle },
};

/** One task: progress, what is happening now (or the review), docs and activity; terminal on demand. */
export function TaskScreen({ task }: { task: TaskSummary }) {
  const { t } = useTranslation(["task", "shell"]);
  const { view, error, reload } = useRun(task.key);
  const { sessions, reload: reloadSessions } = useSessions(task.key);
  const activity = useActivity(task.key);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [restart, setRestart] = useState<"idle" | "confirm" | "busy">("idle");
  const [restartMode, setRestartMode] = useState<string | undefined>();
  const [showPrompt, setShowPrompt] = useState(false);
  const { busyKey, error: doneError, setDone } = useTaskDone();

  const run = view?.run ?? null;
  const steps = view?.workflow.steps ?? [];
  const active = run !== null && ACTIVE_PHASES.includes(run.phase);
  const runSession = sessions.find((s) => s.id === run?.sessionId) ?? null;

  const changed = useCallback(() => {
    void reload();
    void reloadSessions();
  }, [reload, reloadSessions]);

  // Claude can only be answered in the terminal: open it on a permission prompt.
  const asking = sessions.find((s) => s.activity === "permission")?.id;
  useEffect(() => {
    if (!asking) return;
    setActiveSession(asking);
    setDrawerOpen(true);
  }, [asking]);

  useEffect(() => {
    if (run?.sessionId) setActiveSession(run.sessionId);
  }, [run?.sessionId]);

  // A confirmation asked in one phase does not carry over to the next.
  useEffect(() => setRestart("idle"), [run?.phase, run?.stepIndex]);

  const openTerminal = (sessionId?: string) => {
    const id = sessionId ?? run?.sessionId;
    if (id) setActiveSession(id);
    setDrawerOpen(true);
  };
  const askingIds = new Set(sessions.filter((s) => s.activity === "permission").map((s) => s.id));
  const nextStep = run ? steps[run.stepIndex + 1] : undefined;
  const closeDoc = useCallback(() => setDoc(null), []);
  const closePrompt = useCallback(() => setShowPrompt(false), []);
  const sent = run?.sentPrompt;

  // An active run speaks for itself; otherwise the pill says whether the task was marked done.
  const pillPhase: PillPhase | undefined = run && active ? (run.phase as PillPhase) : task.done ? "done" : undefined;
  const pill = pillPhase && PHASE_PILL[pillPhase];
  const PillIcon = pill?.icon;
  const working = run?.phase === "running" || run?.phase === "starting";
  // Interrupted, finished and cancelled runs offer the restart in the card already.
  const toolbarRestart = run !== null && !["interrupted", "done", "cancelled"].includes(run.phase);

  return (
    <div className="task-screen">
      <div className="task-scroll">
        <PageHeader
          crumbs={
            <>
              <a href={href({ page: "overview" })}>{t("shell:nav.overview")}</a> / <a href={href({ page: "tasks" })}>{t("shell:nav.tasks")}</a> /{" "}
              <span aria-current="page">{task.key}</span>
            </>
          }
          title={
            <>
              <span className="title-key">{task.key}</span>
              {task.title !== task.key && task.title}
            </>
          }
        />
        <Toolbar
          start={
            pillPhase &&
            pill &&
            PillIcon && (
              <span
                className={`pill ${pill.tone}`}
                title={pillPhase === "done" && task.done?.at ? t("doneAt", { time: new Date(task.done.at).toLocaleString("vi-VN") }) : undefined}
              >
                <PillIcon weight="bold" className={working ? "spin" : undefined} aria-hidden="true" />
                {t(`phase.${pillPhase}`)}
              </span>
            )
          }
          actions={
            <>
              {sent && (
                <Button icon={Scroll} variant="quiet" title={t("sentPromptTitle")} onClick={() => setShowPrompt(true)}>
                  {t("sentPrompt")}
                </Button>
              )}
              {restart === "confirm" && <span className="toolbar-hint">{t("restartHint")}</span>}
              {toolbarRestart &&
                (restart === "idle" ? (
                  <Button icon={ArrowCounterClockwise} variant="quiet" title={t("restartTitle")} onClick={() => setRestart("confirm")}>
                    {t("restart")}
                  </Button>
                ) : (
                  <>
                    <ModePicker value={restartMode} onChange={setRestartMode} disabled={restart === "busy"} />
                    <Button
                      icon={ArrowCounterClockwise}
                      variant="attention"
                      busy={restart === "busy"}
                      onClick={() => {
                        setRestart("busy");
                        void workflowApi
                          .restartRun(task.key, restartMode)
                          .then(changed)
                          .finally(() => setRestart("idle"));
                      }}
                    >
                      {t("restartConfirm")}
                    </Button>
                  </>
                ))}
              {view &&
                !active &&
                (task.done ? (
                  <Button icon={ArrowUUpLeft} variant="quiet" busy={busyKey === task.key} title={t("reopenTitle")} onClick={() => void setDone(task.key, false)}>
                    {t("reopen")}
                  </Button>
                ) : (
                  <Button icon={CheckCircle} busy={busyKey === task.key} title={t("markDoneTitle")} onClick={() => void setDone(task.key, true)}>
                    {t("markDone")}
                  </Button>
                ))}
              {active && (
                <Button
                  icon={X}
                  variant="quiet"
                  busy={cancelling}
                  title={t("cancelTitle")}
                  onClick={() => {
                    setCancelling(true);
                    void workflowApi
                      .cancelRun(task.key)
                      .then(changed)
                      .finally(() => setCancelling(false));
                  }}
                >
                  {t("cancel")}
                </Button>
              )}
            </>
          }
        />

        {(error || doneError) && (
          <p className="error task-error" role="alert">
            {error ?? doneError}
          </p>
        )}

        {view && (
          <div className="task-content">
            <Stepper steps={steps} run={run} />
            <div className="task-body">
              <div className="task-main">
                {run?.phase === "gate" ? (
                  <GateCard
                    taskKey={task.key}
                    run={run}
                    step={steps[run.stepIndex]}
                    questions={view.questions}
                    assignments={nextStep?.dispatch ? view.assignments : null}
                    parallel={nextStep?.dispatch?.parallel ?? 1}
                    isLast={run.stepIndex === steps.length - 1}
                    docVersion={task.updatedAt}
                    onOpenDoc={setDoc}
                    onChanged={changed}
                  />
                ) : (
                  <NowCard
                    taskKey={task.key}
                    steps={steps}
                    run={run}
                    session={runSession}
                    activity={activity}
                    questions={view.questions}
                    subtaskQuestions={view.subtaskQuestions}
                    asking={askingIds}
                    onOpenTerminal={openTerminal}
                    onOpenDoc={setDoc}
                    onChanged={changed}
                  />
                )}
              </div>
              <div className="task-side">
                <DocsPanel task={task} steps={steps} reports={run?.subtasks?.map((s) => s.report)} onOpen={setDoc} />
                <ActivityFeed items={activity} />
              </div>
            </div>
            <p className="workflow-source" title={view.workflow.source}>
              <a href={href({ page: "config", section: "workflow" })}>
                {view.workflow.mode
                  ? t("source", { source: view.workflow.mode.override ? t("sourceModeOverride", { name: view.workflow.mode.name }) : view.workflow.mode.name })
                  : t("source", { source: view.workflow.origin === "repo" ? t("sourceRepo") : t("sourceDefault") })}
              </a>
              {view.workflow.outdated && <span className="workflow-outdated"> · {t("outdated")}</span>}
            </p>
          </div>
        )}
      </div>

      <TerminalDrawer
        scopeLabel="task"
        emptyHint={t("terminalEmpty")}
        onCreate={(agent) => sessionsApi.createSession(task.key, agent)}
        sessions={sessions}
        activeId={activeSession}
        open={drawerOpen}
        runSessionIds={active ? [run.sessionId, ...(run.subtasks ?? []).flatMap((s) => (s.sessionId ? [s.sessionId] : []))] : []}
        onSelect={setActiveSession}
        onToggle={setDrawerOpen}
        onChanged={changed}
      />
      <DocViewer taskKey={task.key} path={doc} version={task.updatedAt} onClose={closeDoc} />
      <TextViewer
        title={showPrompt && sent ? t("sentPromptHead", { step: steps[sent.stepIndex]?.title ?? sent.stepIndex + 1, time: new Date(sent.at).toLocaleString("vi-VN") }) : null}
        text={sent?.text ?? ""}
        onClose={closePrompt}
      />
    </div>
  );
}
