import { Check } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { RunState, WorkflowStep } from "../../api/types";
import { SrOnly } from "../../components/Button";

type NodeState = "done" | "current" | "pending";
interface Node {
  key: string;
  kind: "step" | "gate";
  label: string;
  state: NodeState;
}

const STATE_TEXT: Record<Node["kind"], Record<NodeState, string>> = {
  step: { done: "đã xong", current: "đang làm", pending: "chưa tới" },
  gate: { done: "đã duyệt", current: "đang chờ ba duyệt", pending: "chưa tới" },
};

/** Steps as waypoints and approval gates as diamonds, with an animated progress track. */
export function Stepper({ steps, run }: { steps: WorkflowStep[]; run: RunState | null }) {
  const nodes = buildNodes(steps, run);
  const reached = nodes.reduce((last, n, i) => (n.state !== "pending" ? i : last), -1);
  const progress = nodes.length > 1 ? Math.max(0, reached) / (nodes.length - 1) : 0;
  const working = run?.phase === "running" || run?.phase === "starting";

  return (
    <div className="stepper" style={{ ["--nodes" as string]: nodes.length }}>
      <div className="stepper-track" aria-hidden="true">
        <motion.div
          className="stepper-fill"
          initial={false}
          animate={{ scaleX: progress }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <ol aria-label="Các bước của quy trình">
        {nodes.map((n) => (
          <li
            key={n.key}
            className={`node ${n.kind} ${n.state}${working && n.state === "current" ? " working" : ""}`}
            aria-current={n.state === "current" ? "step" : undefined}
          >
            <span className="node-marker" aria-hidden="true">
              {n.state === "done" && <Check weight="bold" className="node-check" />}
            </span>
            <span className="node-label">
              {n.label}
              <SrOnly>: {STATE_TEXT[n.kind][n.state]}</SrOnly>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function buildNodes(steps: WorkflowStep[], run: RunState | null): Node[] {
  const live = run !== null && run.phase !== "cancelled";
  const at = run?.stepIndex ?? -1;
  const finished = run?.phase === "done";
  const nodes: Node[] = [];
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
  return nodes;
}
