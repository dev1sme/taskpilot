import { Trans, useTranslation } from "react-i18next";
import { href } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { clockTime } from "../../components/Elapsed";
import { PageHeader } from "../shell/PageHeader";
import { sortTasks, statusOf } from "./taskStatus";
import "./tasks.css";

/** The decision log is kept by TaskPilot and Claude together; it is not one of Claude's documents. */
const HISTORY_FILE = "00-history.md";

/** Every task of the repo as a table; needs-you first. */
export function TasksPage() {
  const { t } = useTranslation("tasks");
  const { tasks, repo } = useWorkspace();

  return (
    <div className="page">
      <PageHeader title={t("page.col.task")} subtitle={t("page.subtitle", { count: tasks.length })} />
      <div className="page-body">
        {!repo?.tasksDirExists ? (
          <div className="empty">
            <h2>{t("page.emptyTitle")}</h2>
            <p>
              <Trans t={t} i18nKey="page.emptyBody" components={{ code: <code /> }} />
            </p>
          </div>
        ) : (
          <table className="task-table">
            <thead>
              <tr>
                <th scope="col">{t("page.col.status")}</th>
                <th scope="col">{t("page.col.task")}</th>
                <th scope="col">{t("page.col.docs")}</th>
                <th scope="col">{t("page.col.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {sortTasks(tasks).map((task) => {
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
                      {t("page.docs", { spec: task.specFiles.length, written: task.outputFiles.filter((f) => f.path !== HISTORY_FILE).length })}
                    </td>
                    <td className="muted mono">{clockTime(task.updatedAt)}</td>
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
