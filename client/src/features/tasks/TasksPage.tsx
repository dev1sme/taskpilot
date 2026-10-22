import { ArrowUUpLeft, CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { href } from "../../shared/router";
import { useWorkspace, type TaskSummary } from "../workspace";
import { Button } from "../../shared/ui/Button";
import { clockTime } from "../../shared/ui/Elapsed";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Toolbar } from "../../shared/ui/Toolbar";
import { matchesFilter, runActive, sortTasks, statusOf, type TaskFilter } from "./taskStatus";
import { useTaskDone } from "./useTaskDone";
import "../../shared/ui/table.css";
import "./tasks.css";

const FILTERS: TaskFilter[] = ["open", "done", "all"];
const FILTER_KEY = "taskpilot.tasks.filter";

/** The filter last picked in this browser; "open" when none is stored or storage is blocked. */
function storedFilter(): TaskFilter {
  try {
    const value = localStorage.getItem(FILTER_KEY);
    return FILTERS.includes(value as TaskFilter) ? (value as TaskFilter) : "open";
  } catch {
    return "open";
  }
}

/** Every task of the repo as a table; needs-you first, done last. The decision log is not counted among Claude's documents. */
export function TasksPage() {
  const { t } = useTranslation("tasks");
  const { tasks, repo } = useWorkspace();
  const [filter, setFilter] = useState<TaskFilter>(storedFilter);
  const { busyKey, error, setDone } = useTaskDone();

  const pick = (next: TaskFilter) => {
    setFilter(next);
    try {
      localStorage.setItem(FILTER_KEY, next);
    } catch {
      // Private window or blocked storage: the filter just is not remembered.
    }
  };
  const shown = sortTasks(tasks).filter((task) => matchesFilter(task, filter));

  return (
    <div className="page">
      <PageHeader title={t("page.col.task")} subtitle={t("page.subtitle", { count: tasks.length })} />
      {repo?.tasksDirExists && (
        <Toolbar
          start={
            <div className="task-filter" role="group" aria-label={t("page.filter.label")}>
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => pick(f)}>
                  {t(`page.filter.${f}`)}
                  <span className="task-filter-count">{tasks.filter((task) => matchesFilter(task, f)).length}</span>
                </button>
              ))}
            </div>
          }
        />
      )}
      <div className="page-body">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!repo?.tasksDirExists ? (
          <div className="empty">
            <h2>{t("page.emptyTitle")}</h2>
            <p>
              <Trans t={t} i18nKey="page.emptyBody" values={{ taskKey: t("page.taskKeyPlaceholder") }} components={{ code: <code /> }} />
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h2>{t(`page.filterEmpty.${filter}.title`)}</h2>
            <p>{t(`page.filterEmpty.${filter}.body`)}</p>
          </div>
        ) : (
          <table className="task-table">
            <thead>
              <tr>
                <th scope="col">{t("page.col.status")}</th>
                <th scope="col">{t("page.col.task")}</th>
                <th scope="col">{t("page.col.docs")}</th>
                <th scope="col">{t("page.col.updated")}</th>
                <th scope="col">
                  <span className="sr-only">{t("page.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((task) => {
                const s = statusOf(task);
                return (
                  <tr key={task.key} className={`tone-${s.tone}`}>
                    <td>
                      <span className="status-chip">
                        <span aria-hidden="true">{s.glyph}</span>
                        {s.label}
                      </span>
                    </td>
                    <td>
                      <a href={href({ page: "task", key: task.key })} className="task-link">
                        <span className="mono">{task.key}</span>
                        {task.title !== task.key && <span className="task-link-title">{task.title}</span>}
                      </a>
                    </td>
                    <td className="muted">
                      {t("page.docs", { spec: task.specFiles.length, written: task.outputFiles.filter((f) => f.path !== task.historyFile).length })}
                    </td>
                    <td className="muted mono">{clockTime(task.updatedAt)}</td>
                    <td className="task-action" title={runActive(task) ? t("page.action.blocked") : undefined}>
                      <DoneButton task={task} done={s.kind === "done"} busy={busyKey === task.key} onSet={(done) => void setDone(task.key, done)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Mark done or reopen one row; disabled while a run is active, since the server refuses it then. */
function DoneButton(props: { task: TaskSummary; done: boolean; busy: boolean; onSet: (done: boolean) => void }) {
  const { t } = useTranslation("tasks");
  const active = runActive(props.task);
  const key = props.task.key;
  return (
    <Button
      icon={props.done ? ArrowUUpLeft : CheckCircle}
      variant="quiet"
      busy={props.busy}
      disabled={active}
      aria-label={props.done ? t("page.action.reopenLabel", { key }) : t("page.action.markDoneLabel", { key })}
      onClick={() => props.onSet(!props.done)}
    >
      {props.done ? t("page.action.reopen") : t("page.action.markDone")}
    </Button>
  );
}
