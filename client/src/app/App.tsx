import { List } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToastHost } from "../shared/ui/Toast";
import { AuthGate } from "../features/auth";
import { BackupsPage, ConfigPage } from "../features/config";
import { OverviewPage } from "../features/overview";
import { RepoTerminal } from "../features/sessions";
import { RepoDialog } from "../features/repo";
import { CommandPalette } from "./layout/CommandPalette";
import { OPEN_PALETTE } from "../shared/ui/PageHeader";
import { Sidebar, TOGGLE_SIDEBAR, type SidebarMode } from "./layout/Sidebar";
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

const RAIL_KEY = "taskpilot.sidebar.rail";
/** Same breakpoint as app.css: below it the sidebar is a drawer. */
const NARROW = "(max-width: 860px)";

/** The sidebar folded to the icon rail, remembered in this browser only. */
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRail(rail: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, rail ? "1" : "0");
  } catch {
    // Private window or blocked storage: the rail still works for this page view.
  }
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const query = matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function Shell() {
  const { t } = useTranslation(["shell", "common"]);
  const route = useRoute();
  const { repo, tasks } = useWorkspace();
  const [palette, setPalette] = useState(false);
  const [repoDialog, setRepoDialog] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const narrow = useNarrow();
  const [rail, setRail] = useState(readRail);
  const [drawer, setDrawer] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  const closePalette = useCallback(() => setPalette(false), []);
  const closeRepo = useCallback(() => setRepoDialog(false), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const mode: SidebarMode = narrow ? "drawer" : rail ? "rail" : "full";
  const drawerOpen = narrow && drawer;

  useEffect(() => {
    const open = () => {
      setDrawer(false);
      setPalette(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(false);
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

  // The palette command folds the rail on a wide screen and opens the drawer on a narrow one.
  useEffect(() => {
    const onToggle = () => (narrow ? setDrawer((d) => !d) : setRail((r) => !r));
    window.addEventListener(TOGGLE_SIDEBAR, onToggle);
    return () => window.removeEventListener(TOGGLE_SIDEBAR, onToggle);
  }, [narrow]);

  useEffect(() => writeRail(rail), [rail]);

  // A new page, or a screen grown past the breakpoint, closes the drawer.
  const [seenView, setSeenView] = useState({ route, narrow });
  if (seenView.route !== route || seenView.narrow !== narrow) {
    setSeenView({ route, narrow });
    setDrawer(false);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Focus moves into the drawer when it opens and back to the menu button when it closes.
  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
    else if (drawerWasOpen.current) menuRef.current?.focus();
    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen]);

  // No repo yet: ask for one right away.
  const [seenRepo, setSeenRepo] = useState<typeof repo>();
  if (seenRepo !== repo) {
    setSeenRepo(repo);
    if (repo && !repo.path) setRepoDialog(true);
  }

  const task = route.page === "task" ? tasks.find((x) => x.key === route.key) : undefined;
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? t("common:noRepo");

  return (
    <div className={`shell is-${mode}${drawerOpen ? " drawer-open" : ""}`}>
      <a className="skip-link" href="#main">
        {t("skipNav")}
      </a>
      {narrow && (
        <header className="mobile-bar" inert={drawerOpen}>
          <button ref={menuRef} type="button" className="mobile-menu" onClick={() => setDrawer(true)} aria-label={t("sidebar.open")} aria-expanded={drawerOpen} aria-controls="sidebar">
            <List aria-hidden="true" />
          </button>
          <span className="mobile-repo">{repoName}</span>
        </header>
      )}
      <Sidebar
        route={route}
        mode={mode}
        onToggle={narrow ? closeDrawer : () => setRail((r) => !r)}
        onNavigate={closeDrawer}
        onSwitchRepo={() => {
          setDrawer(false);
          setRepoDialog(true);
        }}
        toggleRef={closeRef}
      />
      {drawerOpen && <div className="sidebar-backdrop" aria-hidden="true" onClick={closeDrawer} />}
      <main id="main" className="main" inert={drawerOpen}>
        {route.page === "overview" && <OverviewPage />}
        {route.page === "tasks" && <TasksPage />}
        {route.page === "config" && <ConfigPage key={`${route.section}/${route.file ?? ""}/${route.cli ?? "shared"}`} section={route.section} file={route.file} cli={route.cli} />}
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
      <CommandPalette open={palette} onClose={closePalette} sidebar={mode} />
      <RepoDialog open={repoDialog} onClose={closeRepo} />
      <ToastHost />
    </div>
  );
}
