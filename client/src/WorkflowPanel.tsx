import { ArrowClockwise, ChatText, Check, Eye, Play, TerminalWindow, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useState } from "react";
import { api, onServerEvent, type RunPhase, type RunView } from "./api";
import { Button, SrOnly } from "./ui";

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

type Action = "start" | "approve" | "feedback" | "retry" | "cancel";

export function WorkflowPanel(props: {
  taskKey: string;
  onShowSession: (id: string) => void;
  onShowFile: (path: string) => void;
}) {
  const { taskKey } = props;
  const [view, setView] = useState<RunView | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackId = useId();

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

  const act = async (name: Action, action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!view) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null;
  }
  const { workflow, run } = view;
  const active = run !== null && ACTIVE.includes(run.phase);
  const step = run ? workflow.steps[run.stepIndex] : undefined;
  const anyBusy = busy !== null;

  return (
    <section className={`workflow phase-${run?.phase ?? "idle"}`} aria-label="Quy trình">
      <Route steps={workflow.steps} run={run} />

      <p className="run-status" role="status" aria-atomic="true">
        {run ? (
          <>
            <strong>{PHASE_LABEL[run.phase]}.</strong> {run.message}
          </>
        ) : (
          "Chưa chạy. Quy trình sẽ mở một session Claude mới và gửi từng bước vào đó."
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="run-actions">
        {!active && (
          <Button
            icon={Play}
            variant="primary"
            busy={busy === "start"}
            disabled={anyBusy}
            onClick={() =>
              void act("start", async () => {
                const started = await api.startRun(taskKey);
                props.onShowSession(started.sessionId);
              })
            }
          >
            {run ? "Chạy lại từ đầu" : "Bắt đầu quy trình"}
          </Button>
        )}

        {run?.phase === "gate" && (
          <>
            <Button
              icon={Check}
              variant="attention"
              busy={busy === "approve"}
              disabled={anyBusy}
              onClick={() => void act("approve", () => api.approve(taskKey))}
            >
              Duyệt
            </Button>
            {step?.doneFile && (
              <Button icon={Eye} onClick={() => props.onShowFile(step.doneFile!)}>
                Xem {step.doneFile}
              </Button>
            )}
          </>
        )}

        {run && ["starting", "waiting", "interrupted"].includes(run.phase) && (
          <Button
            icon={ArrowClockwise}
            variant={run.phase === "starting" ? "default" : "attention"}
            busy={busy === "retry"}
            disabled={anyBusy}
            onClick={() => void act("retry", () => api.retry(taskKey))}
          >
            Gửi lại bước
          </Button>
        )}

        {run && active && (
          <>
            <Button icon={TerminalWindow} onClick={() => props.onShowSession(run.sessionId)}>
              Mở session
            </Button>
            <Button
              icon={X}
              variant="quiet"
              busy={busy === "cancel"}
              disabled={anyBusy}
              onClick={() => void act("cancel", () => api.cancelRun(taskKey))}
            >
              Huỷ quy trình
            </Button>
          </>
        )}
      </div>

      {run?.phase === "gate" && (
        <form
          className="feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void act("feedback", async () => {
              await api.feedback(taskKey, feedback);
              setFeedback("");
              props.onShowSession(run.sessionId);
            });
          }}
        >
          <label htmlFor={feedbackId}>Góp ý cho bước "{step?.title}"</label>
          <p className="field-help" id={`${feedbackId}-help`}>
            Claude sửa lại trong cùng session rồi dừng chờ duyệt lần nữa.
          </p>
          <div className="feedback-row">
            <textarea
              id={feedbackId}
              aria-describedby={`${feedbackId}-help`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Ví dụ: thêm test cho trường hợp danh sách rỗng"
              rows={3}
            />
            <Button type="submit" icon={ChatText} busy={busy === "feedback"} disabled={anyBusy || !feedback.trim()}>
              Gửi góp ý
            </Button>
          </div>
        </form>
      )}

      <p className="workflow-source" title={workflow.source}>
        Quy trình: {workflow.source.endsWith(".claude/workflow.yml") ? ".claude/workflow.yml của repo" : "mặc định"}
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

const STATE_TEXT: Record<RouteNode["kind"], Record<NodeState, string>> = {
  step: { done: "đã xong", current: "đang làm", pending: "chưa tới" },
  gate: { done: "đã duyệt", current: "đang chờ ba duyệt", pending: "chưa tới" },
};

/**
 * The workflow as a route: each step is a waypoint, each approval gate a hold point after it.
 * Shape and a check mark carry the state as well as color.
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
          <span className="marker" aria-hidden="true">
            {n.state === "done" && <Check weight="bold" className="marker-check" />}
          </span>
          <span className="node-label">
            {n.label}
            <SrOnly>: {STATE_TEXT[n.kind][n.state]}</SrOnly>
          </span>
        </li>
      ))}
    </ol>
  );
}
