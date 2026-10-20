import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { ToastHost } from "../components/Toast";
import { AuthGate } from "../features/auth/AuthGate";
import { BackupsPage } from "../features/config/BackupsPage";
import { ConfigPage } from "../features/config/ConfigPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { RepoDialog } from "../features/repo/RepoDialog";
import { CommandPalette } from "../features/shell/CommandPalette";
import { OPEN_PALETTE } from "../features/shell/PageHeader";
import { Sidebar } from "../features/shell/Sidebar";
import { StatusBar } from "../features/shell/StatusBar";
import { TaskScreen } from "../features/task/TaskScreen";
import { TasksPage } from "../features/tasks/TasksPage";
import { useRoute } from "./router";
import { useWorkspace, WorkspaceProvider } from "./workspace";
import "./app.css";

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthGate>
        <WorkspaceProvider>
          <Shell />
        </WorkspaceProvider>
      </AuthGate>
    </MotionConfig>
  );
}

function Shell() {
  const route = useRoute();
  const { repo, tasks } = useWorkspace();
  const [palette, setPalette] = useState(false);
  const [repoDialog, setRepoDialog] = useState(false);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeRepo = useCallback(() => setRepoDialog(false), []);

  useEffect(() => {
    const open = () => setPalette(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener(OPEN_PALETTE, open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_PALETTE, open);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // No repo yet: ask for one right away.
  useEffect(() => {
    if (repo && !repo.path) setRepoDialog(true);
  }, [repo]);

  const task = route.page === "task" ? tasks.find((t) => t.key === route.key) : undefined;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Bỏ qua điều hướng
      </a>
      <Sidebar route={route} onSwitchRepo={() => setRepoDialog(true)} />
      <main id="main" className="main">
        {route.page === "overview" && <OverviewPage />}
        {route.page === "tasks" && <TasksPage />}
        {route.page === "config" && <ConfigPage key={route.section} section={route.section} />}
        {route.page === "backups" && <BackupsPage />}
        {route.page === "task" &&
          (task ? (
            <TaskScreen key={task.key} task={task} />
          ) : (
            <div className="empty-state">
              <h1>Không thấy task {route.key}</h1>
              <p>Task có thể đã bị xoá hoặc đổi tên trong .claude/tasks.</p>
            </div>
          ))}
      </main>
      <StatusBar />
      <CommandPalette open={palette} onClose={closePalette} />
      <RepoDialog open={repoDialog} onClose={closeRepo} />
      <ToastHost />
    </div>
  );
}
