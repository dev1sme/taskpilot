import { List } from "@phosphor-icons/react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RepoDialog } from "@/features/repo/repo-dialog";
import { RepoTerminal } from "@/features/sessions/repo-terminal";
import { repoName, useRepo } from "@/features/workspace/queries";
import { stored, useMedia } from "@/lib/use-media";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { StatusBar } from "./status-bar";

const RAIL_KEY = "taskpilot.sidebar.rail";
/** Below this width the sidebar becomes a drawer over the page. */
const NARROW = "(max-width: 860px)";

/** Sidebar, page, status bar, plus the dialogs every page can open. */
export function Shell() {
  const { t } = useTranslation("shell");
  const repo = useRepo().data;
  const narrow = useMedia(NARROW);
  const [rail, setRail] = useState(() => stored.get(RAIL_KEY) === "1");
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [repoDialog, setRepoDialog] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => stored.set(RAIL_KEY, rail ? "1" : "0"), [rail]);

  // A new page closes the drawer.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setDrawer(false);
  }

  // No repo yet: ask for one right away.
  const [seenRepo, setSeenRepo] = useState(repo);
  if (seenRepo !== repo) {
    setSeenRepo(repo);
    if (repo && !repo.path) setRepoDialog(true);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(false);
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleSidebar = () => (narrow ? setDrawer((open) => !open) : setRail((r) => !r));
  const switchRepo = () => {
    setDrawer(false);
    setRepoDialog(true);
  };
  const sidebarCommand = narrow ? t("sidebar.open") : rail ? t("sidebar.expand") : t("sidebar.collapse");

  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        {t("skipNav")}
      </a>
      <div className="flex min-h-0 flex-1">
        {narrow ? (
          <Sheet open={drawer} onOpenChange={setDrawer}>
            <SheetContent>
              <SheetTitle className="sr-only">{t("nav.label")}</SheetTitle>
              <Sidebar mode="drawer" onToggle={() => setDrawer(false)} onNavigate={() => setDrawer(false)} onSwitchRepo={switchRepo} />
            </SheetContent>
          </Sheet>
        ) : (
          <aside className="shrink-0 border-r border-line">
            <Sidebar mode={rail ? "rail" : "full"} onToggle={() => setRail((r) => !r)} onNavigate={() => undefined} onSwitchRepo={switchRepo} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {narrow && (
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
              <Button variant="ghost" size="icon" onClick={() => setDrawer(true)} aria-label={t("sidebar.open")} aria-expanded={drawer} aria-controls="sidebar">
                <List aria-hidden />
              </Button>
              <span className="truncate text-sm font-medium">{repoName(repo?.path) ?? t("noRepo")}</span>
            </header>
          )}
          <main id="main" className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </main>
          {repo?.path && <RepoTerminal open={terminal} onToggle={setTerminal} />}
        </div>
      </div>
      <StatusBar terminalOpen={terminal} onToggleTerminal={repo?.path ? () => setTerminal((open) => !open) : undefined} />
      <CommandPalette open={palette} onOpenChange={setPalette} sidebarCommand={sidebarCommand} onSidebar={toggleSidebar} />
      <RepoDialog open={repoDialog} onOpenChange={setRepoDialog} repo={repo} />
    </div>
  );
}
