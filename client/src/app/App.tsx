import { Compass } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { api, token } from "../api/client";
import { onServerEvent } from "../api/events";
import type { RepoInfo, TaskSummary } from "../api/types";
import { RepoPicker } from "../features/repo/RepoPicker";
import { TaskScreen } from "../features/task/TaskScreen";
import { TaskList } from "../features/tasks/TaskList";
import "./app.css";

export function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await api.tasks());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api
      .repo()
      .then((r) => {
        setRepo(r);
        if (r.path) void loadTasks();
      })
      .catch((e: Error) => setError(e.message));
  }, [loadTasks]);

  useEffect(() => {
    // Run phase and permission prompts change the list too.
    const offs = ["tasks", "repo", "run", "sessions"].map((e) => onServerEvent(e, () => void loadTasks()));
    return () => offs.forEach((off) => off());
  }, [loadTasks]);

  if (!token) {
    return (
      <main className="empty-state">
        <h1>TaskPilot</h1>
        <p>Thiếu token. Mở đúng URL mà server in ra khi khởi động (có ?token=…).</p>
      </main>
    );
  }

  const current = tasks.find((t) => t.key === selected) ?? null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <Compass weight="duotone" aria-hidden="true" />
            TaskPilot
          </div>
          <RepoPicker
            repo={repo}
            onChange={async (path) => {
              setRepo(await api.setRepo(path));
              setSelected(null);
              await loadTasks();
            }}
          />
        </header>

        <aside className="sidebar">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!repo?.path && <p className="hint">Nhập đường dẫn repo ở trên để xem task.</p>}
          {repo?.path && !repo.tasksDirExists && (
            <p className="hint">
              Repo này chưa có <code>.claude/tasks/</code>. Tạo <code>.claude/tasks/&lt;key&gt;/spec/</code> rồi viết yêu
              cầu vào đó.
            </p>
          )}
          {repo?.path && repo.tasksDirExists && tasks.length === 0 && (
            <p className="hint">
              Chưa có task. Mỗi task là một thư mục <code>.claude/tasks/&lt;key&gt;/spec/</code> chứa file <code>.md</code>.
            </p>
          )}
          {tasks.length > 0 && <TaskList tasks={tasks} selected={selected} onSelect={setSelected} />}
        </aside>

        <main className="main">
          {current ? (
            <TaskScreen key={current.key} task={current} />
          ) : (
            tasks.length > 0 && (
              <div className="main-empty">
                <Compass weight="duotone" aria-hidden="true" />
                <p>Chọn một task bên trái để theo dõi quy trình.</p>
              </div>
            )
          )}
        </main>
      </div>
    </MotionConfig>
  );
}
