import { useCallback, useEffect, useState } from "react";
import { api, onServerEvent, type RunPhase, type RunView } from "./api";

const ACTIVE: RunPhase[] = ["starting", "running", "waiting", "gate", "interrupted"];

const PHASE_LABEL: Record<RunPhase, string> = {
  starting: "Đang khởi động",
  running: "Claude đang làm",
  waiting: "Chờ ba trong terminal",
  gate: "Chờ duyệt",
  interrupted: "Bị gián đoạn",
  done: "Hoàn tất",
  cancelled: "Đã huỷ",
};

export function WorkflowPanel(props: {
  taskKey: string;
  onShowSession: (id: string) => void;
  onShowFile: (path: string) => void;
}) {
  const { taskKey } = props;
  const [view, setView] = useState<RunView | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.run(taskKey));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskKey]);

  useEffect(() => {
    void load();
    return onServerEvent("run", (data) => {
      if ((data as { taskKey?: string }).taskKey === taskKey) void load();
    });
  }, [load, taskKey]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!view) return error ? <p className="error">{error}</p> : null;
  const { workflow, run } = view;
  const active = run !== null && ACTIVE.includes(run.phase);
  const step = run ? workflow.steps[run.stepIndex] : undefined;


  return (
    <section className={`workflow ${run?.phase ?? "idle"}`} aria-label="Quy trình">
      <Route steps={workflow.steps} run={run} />

      {run && (
        <p className="run-status">
          <strong>{PHASE_LABEL[run.phase]}.</strong> {run.message}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="run-actions">
        {!active && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const started = await api.startRun(taskKey);
                props.onShowSession(started.sessionId);
              })
            }
          >
            {run ? "Chạy quy trình lại từ đầu" : "Bắt đầu quy trình"}
          </button>
        )}

        {run?.phase === "gate" && (
          <>
            {step?.doneFile && (
              <button type="button" onClick={() => props.onShowFile(step.doneFile!)}>
                Xem {step.doneFile}
              </button>
            )}
            <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approve(taskKey))}>
              Duyệt
            </button>
          </>
        )}

        {run && ["starting", "waiting", "interrupted"].includes(run.phase) && (
          <button type="button" disabled={busy} onClick={() => void act(() => api.retry(taskKey))}>
            Gửi lại bước
          </button>
        )}

        {run && active && (
          <>
            <button type="button" onClick={() => props.onShowSession(run.sessionId)}>
              Mở session
            </button>
            <button type="button" className="quiet" disabled={busy} onClick={() => void act(() => api.cancelRun(taskKey))}>
              Huỷ quy trình
            </button>
          </>
        )}
      </div>

      {run?.phase === "gate" && (
        <form
          className="feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.feedback(taskKey, feedback);
              setFeedback("");
              props.onShowSession(run.sessionId);
            });
          }}
        >
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Góp ý để Claude sửa lại bước này…"
            aria-label="Góp ý"
            rows={3}
          />
          <button type="submit" disabled={busy || !feedback.trim()}>
            Gửi góp ý
          </button>
        </form>
      )}

      <p className="workflow-source" title={workflow.source}>
        Quy trình: {workflow.source.endsWith(".claude/workflow.yml") ? ".claude/workflow.yml" : "mặc định"}
      </p>
    </section>
  );
}

type NodeState = "done" | "current" | "pending";
interface RouteNode {
  key: string;
  kind: "step" | "gate";
  label: string;
  state: NodeState;
}

/**
 * The workflow as a route: each step is a waypoint, each approval gate a hold point after it.
 * Shows where the run is and, at a gate, that it is waiting on the user.
 */
function Route({ steps, run }: { steps: RunView["workflow"]["steps"]; run: RunView["run"] }) {
  const live = run !== null && run.phase !== "cancelled";
  const at = run?.stepIndex ?? -1;
  const finished = run?.phase === "done";
  const nodes: RouteNode[] = [];
  steps.forEach((step, i) => {
    const stepDone = live && (finished || i < at || (i === at && run!.phase === "gate"));
    nodes.push({
      key: step.id,
      kind: "step",
      label: step.title,
      state: stepDone ? "done" : live && i === at ? "current" : "pending",
    });
    if (step.gate === "approve") {
      const gateDone = live && (finished || i < at);
      nodes.push({
        key: `${step.id}-gate`,
        kind: "gate",
        label: "Ba duyệt",
        state: gateDone ? "done" : live && i === at && run!.phase === "gate" ? "current" : "pending",
      });
    }
  });
  const running = run?.phase === "running" || run?.phase === "starting";

  return (
    <ol className={`route${running ? " is-running" : ""}`} aria-label="Các bước của quy trình">
      {nodes.map((n) => (
        <li key={n.key} className={`node ${n.kind} ${n.state}`} aria-current={n.state === "current" ? "step" : undefined}>
          <span className="marker" aria-hidden="true" />
          <span className="node-label">{n.label}</span>
        </li>
      ))}
    </ol>
  );
}
