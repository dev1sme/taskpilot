import { ArrowCounterClockwise, CheckCircle, ChatCircleDots, CircleNotch, Diamond, PlugsConnected, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { href } from "../../shared/router";
import { Button } from "../../shared/ui/Button";
import { ActivityFeed, useActivity } from "../activity";
import { DocsPanel, DocViewer } from "../docs";
import { TerminalDrawer, useSessions, sessionsApi } from "../sessions";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Toolbar } from "../../shared/ui/Toolbar";
import { GateCard, NowCard, Stepper, ACTIVE_PHASES, useRun, workflowApi, type RunPhase } from "../workflow";
import "../workflow/workflow.css";
import "./task.css";
import type { TaskSummary } from "../workspace";

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

  const openTerminal = () => {
    if (run) setActiveSession(run.sessionId);
    setDrawerOpen(true);
  };
  const closeDoc = useCallback(() => setDoc(null), []);

  const pillPhase = run && run.phase !== "cancelled" ? run.phase : undefined;
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
              <span className={`pill ${pill.tone}`}>
                <PillIcon weight="bold" className={working ? "spin" : undefined} aria-hidden="true" />
                {t(`phase.${pillPhase}`)}
              </span>
            )
          }
          actions={
            <>
              {restart === "confirm" && <span className="toolbar-hint">{t("restartHint")}</span>}
              {toolbarRestart &&
                (restart === "idle" ? (
                  <Button icon={ArrowCounterClockwise} variant="quiet" title={t("restartTitle")} onClick={() => setRestart("confirm")}>
                    {t("restart")}
                  </Button>
                ) : (
                  <Button
                    icon={ArrowCounterClockwise}
                    variant="attention"
                    busy={restart === "busy"}
                    onClick={() => {
                      setRestart("busy");
                      void workflowApi
                        .restartRun(task.key)
                        .then(changed)
                        .finally(() => setRestart("idle"));
                    }}
                  >
                    {t("restartConfirm")}
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

        {error && (
          <p className="error task-error" role="alert">
            {error}
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
                    onOpenTerminal={openTerminal}
                    onOpenDoc={setDoc}
                    onChanged={changed}
                  />
                )}
              </div>
              <div className="task-side">
                <DocsPanel task={task} steps={steps} onOpen={setDoc} />
                <ActivityFeed items={activity} />
              </div>
            </div>
            <p className="workflow-source" title={view.workflow.source}>
              {t("source", { source: view.workflow.source.endsWith(".claude/workflow.yml") ? t("sourceRepo") : t("sourceDefault") })}
            </p>
          </div>
        )}
      </div>

      <TerminalDrawer
        scopeLabel="task"
        emptyHint={t("terminalEmpty")}
        onCreate={() => sessionsApi.createSession(task.key)}
        sessions={sessions}
        activeId={activeSession}
        open={drawerOpen}
        runSessionId={active ? (run?.sessionId ?? null) : null}
        onSelect={setActiveSession}
        onToggle={setDrawerOpen}
        onChanged={changed}
      />
      <DocViewer taskKey={task.key} path={doc} version={task.updatedAt} onClose={closeDoc} />
    </div>
  );
}
