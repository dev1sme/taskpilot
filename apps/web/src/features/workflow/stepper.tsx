import type { RunView } from "@taskpilot/server/api-types";
import { Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type Step = RunView["workflow"]["steps"][number];
type NodeState = "done" | "current" | "pending";
interface Node {
  key: string;
  kind: "step" | "gate";
  label: string;
  state: NodeState;
}

/** Steps as waypoints and approval gates as diamonds, on one progress track. */
export function Stepper({ steps, run }: { steps: Step[]; run: RunView["run"] }) {
  const { t } = useTranslation("workflow");
  const nodes = buildNodes(steps, run, t("stepper.gate"), (label, done, total) => t("stepper.dispatchCount", { label, done, total }));
  const working = run?.phase === "running" || run?.phase === "starting";
  return (
    <ol aria-label={t("stepper.label")} className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {nodes.map((node, i) => (
        <li key={node.key} aria-current={node.state === "current" ? "step" : undefined} className="flex items-center gap-2 text-sm">
          {i > 0 && <span aria-hidden className={cn("h-px w-4 sm:w-6", node.state === "pending" ? "bg-line" : "bg-signal")} />}
          <span
            aria-hidden
            className={cn(
              "grid size-5 shrink-0 place-items-center border text-[11px]",
              node.kind === "gate" ? "size-4 rotate-45 rounded-[3px]" : "rounded-full",
              node.state === "done" && "border-signal bg-signal text-on-signal",
              node.state === "current" && "border-signal bg-signal-soft",
              node.state === "current" && working && "animate-pulse",
              node.state === "pending" && "border-line-strong",
            )}
          >
            {node.state === "done" && <Check weight="bold" className={cn("size-3", node.kind === "gate" && "-rotate-45")} />}
          </span>
          <span className={cn(node.state === "pending" ? "text-faint" : "text-ink", node.state === "current" && "font-medium")}>
            {node.label}
            <span className="sr-only">: {t(`stepper.state.${node.kind}.${node.state}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function buildNodes(steps: Step[], run: RunView["run"], gateLabel: string, counted: (label: string, done: number, total: number) => string): Node[] {
  const live = run !== null && run.phase !== "cancelled";
  const at = run?.stepIndex ?? -1;
  const finished = run?.phase === "done";
  const nodes: Node[] = [];
  steps.forEach((step, i) => {
    const stepDone = live && (finished || i < at || (i === at && run.phase === "gate"));
    nodes.push({
      key: step.id,
      kind: "step",
      label: step.dispatch && run?.subtasks ? counted(step.title, run.subtasks.filter((s) => s.phase === "done").length, run.subtasks.length) : step.title,
      state: stepDone ? "done" : live && i === at ? "current" : "pending",
    });
    if (step.gate === "approve") {
      nodes.push({
        key: `${step.id}-gate`,
        kind: "gate",
        label: gateLabel,
        state: live && (finished || i < at) ? "done" : live && i === at && run.phase === "gate" ? "current" : "pending",
      });
    }
  });
  return nodes;
}
