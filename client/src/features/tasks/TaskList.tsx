import { CheckCircle, CircleNotch, HandPalm } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { TaskSummary } from "../../api/types";
import { statusOf, urgency, type Tone } from "./taskStatus";
import "./tasks.css";

/** Tasks as strips; ones that need the user float to the top (animated reorder). */
export function TaskList(props: { tasks: TaskSummary[]; selected: string | null; onSelect: (key: string) => void }) {
  const ordered = [...props.tasks].sort((a, b) => urgency(b) - urgency(a) || b.updatedAt - a.updatedAt);
  const waiting = ordered.filter((t) => statusOf(t).tone === "attention").length;

  return (
    <nav className="task-list" aria-label="Task">
      <div className="task-list-head">
        <h2>Task</h2>
        {waiting > 0 && (
          <span className="pill attention" role="status">
            {waiting} cần ba
          </span>
        )}
      </div>
      <ul>
        {ordered.map((t) => {
          const status = statusOf(t);
          return (
            <motion.li key={t.key} layout transition={{ type: "spring", stiffness: 500, damping: 40 }}>
              <button
                type="button"
                className={`strip tone-${status.tone}`}
                aria-current={t.key === props.selected ? "page" : undefined}
                onClick={() => props.onSelect(t.key)}
              >
                <span className="strip-key">{t.key}</span>
                <span className="strip-status">
                  <StatusIcon tone={status.tone} />
                  {status.label}
                </span>
                {t.title !== t.key && <span className="strip-title">{t.title}</span>}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </nav>
  );
}

function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "attention") return <HandPalm weight="fill" className="strip-icon pulse" aria-hidden="true" />;
  if (tone === "active") return <CircleNotch weight="bold" className="strip-icon spin" aria-hidden="true" />;
  if (tone === "done") return <CheckCircle weight="fill" className="strip-icon" aria-hidden="true" />;
  return null;
}
