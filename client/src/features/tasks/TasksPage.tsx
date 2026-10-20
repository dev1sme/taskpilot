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
  const { tasks, repo } = useWorkspace();

  return (
    <div className="page">
      <PageHeader title="Task" subtitle={`${tasks.length} task trong .claude/tasks`} />
      <div className="page-body">
        {!repo?.tasksDirExists ? (
          <div className="empty">
            <h2>Repo chưa có task</h2>
            <p>
              Tạo thư mục <code>.claude/tasks/&lt;mã task&gt;/spec/</code> và viết yêu cầu vào file <code>.md</code>.
              TaskPilot tự nhận task mới.
            </p>
          </div>
        ) : (
          <table className="task-table">
            <thead>
              <tr>
                <th scope="col">Trạng thái</th>
                <th scope="col">Task</th>
                <th scope="col">Tài liệu</th>
                <th scope="col">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {sortTasks(tasks).map((t) => {
                const s = statusOf(t);
                return (
                  <tr key={t.key} className={`tone-${s.tone}`}>
                    <td>
                      <span className="status-chip">
                        <span aria-hidden="true">{s.glyph}</span>
                        {s.label}
                      </span>
                    </td>
                    <td>
                      <a href={href({ page: "task", key: t.key })} className="task-link">
                        <span className="mono">{t.key}</span>
                        {t.title !== t.key && <span className="task-link-title">{t.title}</span>}
                      </a>
                    </td>
                    <td className="muted">
                      {t.specFiles.length} spec · {t.outputFiles.filter((f) => f.path !== HISTORY_FILE).length} Claude viết
                    </td>
                    <td className="muted mono">{clockTime(t.updatedAt)}</td>
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
