import { CheckCircle, ChatCircleDots, CircleNotch, Diamond, PlugsConnected, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RunPhase, TaskSummary } from "../../api/types";
import { Button } from "../../components/Button";
import { ActivityFeed } from "../activity/ActivityFeed";
import { useActivity } from "../activity/useActivity";
import { DocsPanel } from "../docs/DocsPanel";
import { DocViewer } from "../docs/DocViewer";
import { TerminalDrawer } from "../sessions/TerminalDrawer";
import { useSessions } from "../sessions/useSessions";
import { GateCard } from "../workflow/GateCard";
import { NowCard } from "../workflow/NowCard";
import { Stepper } from "../workflow/Stepper";
import { ACTIVE_PHASES, useRun } from "../workflow/useRun";
import "../workflow/workflow.css";
import "./task.css";

const PHASE_PILL: Partial<Record<RunPhase, { tone: string; label: string; icon: typeof CheckCircle }>> = {
  starting: { tone: "signal", label: "Đang khởi động", icon: CircleNotch },
  running: { tone: "signal", label: "Claude đang làm", icon: CircleNotch },
  waiting: { tone: "attention", label: "Chờ ba trả lời", icon: ChatCircleDots },
  gate: { tone: "attention", label: "Chờ duyệt", icon: Diamond },
  interrupted: { tone: "attention", label: "Gián đoạn", icon: PlugsConnected },
  done: { tone: "done", label: "Hoàn tất", icon: CheckCircle },
};

/** Mission control for one task: progress, what is happening now, the log, the docs; terminal on demand. */
export function TaskScreen({ task }: { task: TaskSummary }) {
  const { view, error, reload } = useRun(task.key);
  const { sessions, reload: reloadSessions } = useSessions(task.key);
  const activity = useActivity(task.key);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

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

  const openTerminal = () => {
    if (run) setActiveSession(run.sessionId);
    setDrawerOpen(true);
  };
  const closeDoc = useCallback(() => setDoc(null), []);

  const pill = run ? PHASE_PILL[run.phase] : undefined;
  const PillIcon = pill?.icon;

  return (
    <div className="task-screen">
      <div className="task-scroll">
        <div className="task-top">
        <header className="task-head">
          <div className="task-title">
            <span className="task-key">{task.key}</span>
            {task.title !== task.key && <h1>{task.title}</h1>}
          </div>
          <div className="task-head-side">
            {pill && PillIcon && (
              <span className={`pill ${pill.tone}`}>
                <PillIcon weight="bold" className={run?.phase === "running" || run?.phase === "starting" ? "spin" : undefined} aria-hidden="true" />
                {pill.label}
              </span>
            )}
            {active && (
              <Button
                icon={X}
                variant="quiet"
                busy={cancelling}
                onClick={() => {
                  setCancelling(true);
                  void api
                    .cancelRun(task.key)
                    .then(changed)
                    .finally(() => setCancelling(false));
                }}
              >
                Huỷ quy trình
              </Button>
            )}
          </div>
        </header>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {view && <Stepper steps={steps} run={run} />}
        </div>

        {view && (
          <>
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
                <ActivityFeed items={activity} />
              </div>
              <DocsPanel task={task} steps={steps} onOpen={setDoc} />
            </div>
            <p className="workflow-source" title={view.workflow.source}>
              Quy trình: {view.workflow.source.endsWith(".claude/workflow.yml") ? ".claude/workflow.yml của repo" : "mặc định của TaskPilot"}
            </p>
          </>
        )}
      </div>

      <TerminalDrawer
        taskKey={task.key}
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
