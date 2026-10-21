import {
  BookOpenText,
  CaretDown,
  ClockCounterClockwise,
  CaretUpDown,
  ChartLineUp,
  Command,
  FileText,
  FlowArrow,
  Gear,
  Lightning,
  ListChecks,
  Plugs,
  Robot,
  SignOut,
  Sparkle,
  TreeStructure,
  type Icon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { href, type Route } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { useDrafts } from "../../features/config";
import { sortTasks, statusOf } from "../../features/tasks";
import { logout, useAuthMode } from "../../features/auth";
import type { TaskSummary } from "../../features/workspace";
import "../../shared/ui/brand-mark.css";
import "./sidebar.css";

interface NavItem {
  label: string;
  icon: Icon;
  route: Route;
  badge?: number;
  warn?: boolean;
  /** Has unsaved edits. */
  dirty?: boolean;
}

/** Rows of the task list in the sidebar; the rest are one click away on the Task page. */
const TASK_LIMIT = 6;
const COLLAPSED_KEY = "taskpilot.sidebar.collapsed";

type GroupId = "workspace" | "claude" | "integrations";

/** Groups the user folded, remembered in this browser only. */
function readCollapsed(): GroupId[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is GroupId => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: GroupId[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Private window or blocked storage: folding still works for this page view.
  }
}

/**
 * App navigation in three zones: brand and repo on top, the scrolling nav (task list nested under
 * "Task", foldable groups) in the middle, and the account (log out, agent versions) at the bottom.
 */
export function Sidebar({ route, onSwitchRepo }: { route: Route; onSwitchRepo: () => void }) {
  const { t } = useTranslation(["shell", "common"]);
  const { repo, tasks, inventory, info } = useWorkspace();
  const drafts = useDrafts();
  const mode = useAuthMode();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const dirty = (prefix: string) => drafts.some((k) => k.startsWith(prefix));
  const waiting = tasks.filter((x) => statusOf(x).tone === "attention").length;
  const inTasks = route.page === "tasks" || route.page === "task";
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? t("common:noRepo");

  // The workspace pages lead without a label; the config groups below can fold.
  const groups: Array<{ id: GroupId; label: string; foldable: boolean; items: NavItem[] }> = [
    {
      id: "workspace",
      label: t("navGroup.workspace"),
      foldable: false,
      items: [
        { label: t("nav.overview"), icon: ChartLineUp, route: { page: "overview" } },
        { label: t("nav.tasks"), icon: ListChecks, route: { page: "tasks" }, badge: waiting || undefined, warn: waiting > 0 },
      ],
    },
    {
      id: "claude",
      label: t("navGroup.claude"),
      foldable: true,
      items: [
        { label: t("nav.memory"), icon: BookOpenText, route: { page: "config", section: "memory" }, dirty: dirty("memory:") },
        { label: t("nav.settings"), icon: Gear, route: { page: "config", section: "settings" }, dirty: dirty("settings:") },
        { label: t("nav.hooks"), icon: Lightning, route: { page: "config", section: "hooks" }, badge: inventory?.claudeDir.hooks || undefined, dirty: dirty("hooks") },
        { label: t("nav.agents"), icon: Robot, route: { page: "config", section: "agents" }, badge: inventory?.claudeDir.agents || undefined, dirty: dirty("library:agents") },
        { label: t("nav.commands"), icon: Command, route: { page: "config", section: "commands" }, badge: inventory?.claudeDir.commands || undefined, dirty: dirty("library:commands") },
        { label: t("nav.skills"), icon: Sparkle, route: { page: "config", section: "skills" }, badge: inventory?.claudeDir.skills || undefined, dirty: dirty("library:skills") },
        { label: t("nav.workflow"), icon: FlowArrow, route: { page: "config", section: "workflow" }, dirty: dirty("workflow:") },
        { label: t("nav.formats"), icon: FileText, route: { page: "config", section: "formats" } },
        { label: t("nav.backups"), icon: ClockCounterClockwise, route: { page: "backups" } },
      ],
    },
    {
      id: "integrations",
      label: t("navGroup.integrations"),
      foldable: true,
      items: [
        {
          label: t("nav.mcp"),
          icon: Plugs,
          route: { page: "config", section: "mcp" },
          badge: inventory?.mcp.servers.length || undefined,
          warn: Boolean(inventory?.mcp.error),
        },
        { label: t("nav.codegraph"), icon: TreeStructure, route: { page: "config", section: "codegraph" } },
      ],
    },
  ];

  const isActive = (r: Route) => {
    if (r.page === "config") return route.page === "config" && route.section === r.section;
    if (r.page === "tasks") return inTasks;
    return r.page === route.page;
  };

  // Opening a page inside a folded group unfolds it, so the current page is always in view.
  const activeGroup = groups.find((g) => g.items.some((it) => isActive(it.route)))?.id;
  useEffect(() => {
    if (!activeGroup) return;
    setCollapsed((ids) => {
      if (!ids.includes(activeGroup)) return ids;
      const next = ids.filter((id) => id !== activeGroup);
      writeCollapsed(next);
      return next;
    });
  }, [activeGroup]);

  const toggle = (id: GroupId) =>
    setCollapsed((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      writeCollapsed(next);
      return next;
    });

  const currentKey = route.page === "task" ? route.key : null;
  const claude = info?.claudeVersion ? t("account.claudeVersion", { version: info.claudeVersion }) : t("account.claudeMissing");
  // Copilot is optional: shown only when installed.
  const copilot = info?.versions?.copilot ? t("account.copilotVersion", { version: info.versions.copilot }) : null;
  const versions = [claude, copilot].filter(Boolean).join("\n");

  return (
    <nav className="sidebar" aria-label={t("nav.label")}>
      <div className="sidebar-head">
        <a className="brand" href={href({ page: "overview" })}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
              <path d="M3 12l18-8-8 18-2-8-8-2z" />
            </svg>
          </span>
          {t("common:appName")}
        </a>

        <button type="button" className="repo-switch" onClick={onSwitchRepo}>
          <span className="repo-avatar" aria-hidden="true">
            {repoName.slice(0, 2).toLowerCase()}
          </span>
          <span className="repo-text">
            <span className="repo-name">{repoName}</span>
            <span className="repo-path">{repo?.path ?? t("repoSwitch")}</span>
          </span>
          <CaretUpDown aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar-nav">
        {groups.map((g) => {
          const open = !g.foldable || !collapsed.includes(g.id);
          const listId = `nav-group-${g.id}`;
          return (
            <div className="nav-group" key={g.id}>
              {g.foldable ? (
                <button type="button" className="nav-label nav-toggle" aria-expanded={open} aria-controls={listId} onClick={() => toggle(g.id)}>
                  <span>{g.label}</span>
                  <CaretDown className="nav-toggle-caret" aria-hidden="true" />
                </button>
              ) : (
                <div className="sr-only">{g.label}</div>
              )}
              <ul id={listId} hidden={!open}>
                {g.items.map((it) => {
                  const active = isActive(it.route);
                  return (
                    <li key={it.label}>
                      <a className="nav-item" href={href(it.route)} aria-current={active ? "page" : undefined}>
                        {active && <motion.span className="nav-active" layoutId="nav-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                        <it.icon className="nav-icon" weight={active ? "fill" : "regular"} aria-hidden="true" />
                        <span className="nav-text">{it.label}</span>
                        {it.dirty && <span className="nav-dirty" title={t("common:unsavedTitle")} aria-label={t("common:unsaved")} />}
                        {it.badge !== undefined && <span className={`nav-badge${it.warn ? " is-warn" : ""}`}>{it.badge}</span>}
                      </a>
                      {it.route.page === "tasks" && inTasks && tasks.length > 0 && <TaskList tasks={tasks} currentKey={currentKey} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="sidebar-account">
        <div className="account-versions" title={versions}>
          <span>{claude}</span>
          {copilot && <span>{copilot}</span>}
        </div>
        {mode === "password" && (
          <button type="button" className="account-logout" onClick={() => void logout()}>
            <SignOut aria-hidden="true" />
            {t("account.logout")}
          </button>
        )}
      </div>
    </nav>
  );
}

/**
 * The most urgent tasks (needs-you first, then running, then recent), capped at TASK_LIMIT; the open
 * task is kept even when it falls outside the cap.
 */
function TaskList({ tasks, currentKey }: { tasks: TaskSummary[]; currentKey: string | null }) {
  const { t } = useTranslation("shell");
  const sorted = sortTasks(tasks);
  const shown = sorted.slice(0, TASK_LIMIT);
  const current = currentKey ? sorted.find((x) => x.key === currentKey) : undefined;
  if (current && !shown.includes(current)) shown.push(current);

  return (
    <ul className="nav-tasks" aria-label={t("nav.tasks")}>
      {shown.map((task) => {
        const s = statusOf(task);
        return (
          <li key={task.key}>
            <a
              className={`nav-task tone-${s.tone}`}
              href={href({ page: "task", key: task.key })}
              aria-current={task.key === currentKey ? "page" : undefined}
              title={`${task.key} · ${task.title} · ${s.label}`}
            >
              <span className="nav-task-glyph" aria-hidden="true">
                {s.glyph}
              </span>
              <span className="nav-task-text">
                <span className="nav-task-key">{task.key}</span>
                {task.title !== task.key && <span className="nav-task-title">{task.title}</span>}
              </span>
              <span className="sr-only">: {s.label}</span>
            </a>
          </li>
        );
      })}
      {tasks.length > shown.length && (
        <li>
          <a className="nav-task nav-task-all" href={href({ page: "tasks" })}>
            {t("nav.allTasks", { count: tasks.length })}
          </a>
        </li>
      )}
    </ul>
  );
}
