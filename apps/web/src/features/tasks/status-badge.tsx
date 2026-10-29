import type { TaskListItem } from "@taskpilot/server/api-types";
import { CheckCircle, Circle, PlayCircle, Diamond, HandPalm, Question, WarningCircle, type Icon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { statusOf, type StatusKind, type Tone } from "./status";

const ICON: Record<StatusKind, Icon> = {
  permission: HandPalm,
  gate: Diamond,
  waiting: Question,
  interrupted: WarningCircle,
  running: PlayCircle,
  done: CheckCircle,
  new: Circle,
  progress: Circle,
  complete: Circle,
};

const TONE: Record<Tone, "attention" | "signal" | "done" | "neutral"> = { attention: "attention", active: "signal", done: "done", idle: "neutral" };

/** A task's status as text with its icon; color never carries it alone. */
export function StatusBadge({ task, className }: { task: TaskListItem; className?: string }) {
  const status = statusOf(task);
  const Icon = ICON[status.kind];
  return (
    <Badge tone={TONE[status.tone]} title={status.title} className={className}>
      <Icon weight={status.tone === "attention" || status.kind === "done" ? "fill" : "bold"} aria-hidden />
      {status.label}
    </Badge>
  );
}
