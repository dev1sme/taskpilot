import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToastHost } from "../shared/ui/Toast";
import { AuthGate } from "../features/auth";
import { BackupsPage, ConfigPage } from "../features/config";
import { OverviewPage } from "../features/overview";
import { RepoTerminal } from "../features/sessions";
import { RepoDialog } from "../features/repo";
import { CommandPalette } from "./layout/CommandPalette";
import { OPEN_PALETTE } from "../shared/ui/PageHeader";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
import { TaskScreen } from "../features/task";
import { TasksPage } from "../features/tasks";
import { useRoute } from "../shared/router";
import { useWorkspace, WorkspaceProvider } from "../features/workspace";
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
  const { t } = useTranslation("shell");
  const route = useRoute();
  const { repo, tasks } = useWorkspace();
  const [palette, setPalette] = useState(false);
  const [repoDialog, setRepoDialog] = useState(false);
  const [terminal, setTerminal] = useState(false);
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

  const task = route.page === "task" ? tasks.find((x) => x.key === route.key) : undefined;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t("skipNav")}
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
              <h1>{t("taskNotFound.title", { key: route.key })}</h1>
              <p>{t("taskNotFound.body")}</p>
            </div>
          ))}
      </main>
      <RepoTerminal open={terminal} onToggle={setTerminal} />
      <StatusBar terminalOpen={terminal} onToggleTerminal={setTerminal} />
      <CommandPalette open={palette} onClose={closePalette} />
      <RepoDialog open={repoDialog} onClose={closeRepo} />
      <ToastHost />
    </div>
  );
}
