import {
  BookOpenText,
  ClockCounterClockwise,
  CaretUpDown,
  ChartLineUp,
  Command,
  Gear,
  Lightning,
  ListChecks,
  Plugs,
  Robot,
  Sparkle,
  type Icon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { href, type Route } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { useDrafts } from "../config/drafts";
import { sortTasks, statusOf } from "../tasks/taskStatus";
import "./shell.css";

interface NavItem {
  label: string;
  icon: Icon;
  route: Route;
  badge?: number;
  warn?: boolean;
  /** Has unsaved edits. */
  dirty?: boolean;
}

/** App navigation: repo switcher, three groups, and the task list nested under "Task". */
export function Sidebar({ route, onSwitchRepo }: { route: Route; onSwitchRepo: () => void }) {
  const { repo, tasks, inventory } = useWorkspace();
  const drafts = useDrafts();
  const dirty = (prefix: string) => drafts.some((k) => k.startsWith(prefix));
  const waiting = tasks.filter((t) => statusOf(t).tone === "attention").length;
  const inTasks = route.page === "tasks" || route.page === "task";
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? "Chưa chọn repo";

  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "Workspace",
      items: [
        { label: "Tổng quan", icon: ChartLineUp, route: { page: "overview" } },
        { label: "Task", icon: ListChecks, route: { page: "tasks" }, badge: waiting || undefined, warn: waiting > 0 },
      ],
    },
    {
      label: "Cấu hình Claude",
      items: [
        { label: "CLAUDE.md", icon: BookOpenText, route: { page: "config", section: "memory" }, dirty: dirty("memory:") },
        { label: "Settings & quyền", icon: Gear, route: { page: "config", section: "settings" }, dirty: dirty("settings:") },
        { label: "Hooks", icon: Lightning, route: { page: "config", section: "hooks" }, badge: inventory?.claudeDir.hooks || undefined },
        { label: "Agents", icon: Robot, route: { page: "config", section: "agents" }, badge: inventory?.claudeDir.agents || undefined },
        { label: "Commands", icon: Command, route: { page: "config", section: "commands" }, badge: inventory?.claudeDir.commands || undefined },
        { label: "Skills", icon: Sparkle, route: { page: "config", section: "skills" }, badge: inventory?.claudeDir.skills || undefined },
        { label: "Lịch sử thay đổi", icon: ClockCounterClockwise, route: { page: "backups" } },
      ],
    },
    {
      label: "Tích hợp",
      items: [
        {
          label: "MCP servers",
          icon: Plugs,
          route: { page: "config", section: "mcp" },
          badge: inventory?.mcp.servers.length || undefined,
          warn: Boolean(inventory?.mcp.error),
        },
      ],
    },
  ];

  const isActive = (r: Route) => {
    if (r.page === "config") return route.page === "config" && route.section === r.section;
    if (r.page === "tasks") return inTasks;
    return r.page === route.page;
  };

  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <a className="brand" href={href({ page: "overview" })}>
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
            <path d="M3 12l18-8-8 18-2-8-8-2z" />
          </svg>
        </span>
        TaskPilot
      </a>

      <button type="button" className="repo-switch" onClick={onSwitchRepo}>
        <span className="repo-avatar" aria-hidden="true">
          {repoName.slice(0, 2).toLowerCase()}
        </span>
        <span className="repo-text">
          <span className="repo-name">{repoName}</span>
          <span className="repo-path">{repo?.path ?? "Bấm để chọn"}</span>
        </span>
        <CaretUpDown aria-hidden="true" />
      </button>

      {groups.map((g) => (
        <div className="nav-group" key={g.label}>
          <div className="nav-label">{g.label}</div>
          <ul>
            {g.items.map((it) => {
              const active = isActive(it.route);
              return (
                <li key={it.label}>
                  <a className="nav-item" href={href(it.route)} aria-current={active ? "page" : undefined}>
                    {active && <motion.span className="nav-active" layoutId="nav-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <it.icon className="nav-icon" weight={active ? "fill" : "regular"} aria-hidden="true" />
                    <span className="nav-text">{it.label}</span>
                    {it.dirty && <span className="nav-dirty" title="Có thay đổi chưa lưu" aria-label="chưa lưu" />}
                    {it.badge !== undefined && <span className={`nav-badge${it.warn ? " is-warn" : ""}`}>{it.badge}</span>}
                  </a>
                  {it.route.page === "tasks" && inTasks && tasks.length > 0 && (
                    <ul className="nav-tasks" aria-label="Task">
                      {sortTasks(tasks).map((t) => {
                        const s = statusOf(t);
                        const current = route.page === "task" && route.key === t.key;
                        return (
                          <li key={t.key}>
                            <a
                              className={`nav-task tone-${s.tone}`}
                              href={href({ page: "task", key: t.key })}
                              aria-current={current ? "page" : undefined}
                              title={`${t.key} · ${s.label}`}
                            >
                              <span className="nav-task-glyph" aria-hidden="true">
                                {s.glyph}
                              </span>
                              <span className="nav-task-text">
                                <span className="nav-task-key">{t.key}</span>
                                {t.title !== t.key && <span className="nav-task-title">{t.title}</span>}
                              </span>
                              <span className="sr-only">: {s.label}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
