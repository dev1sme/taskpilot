import {
  BookOpenText,
  CaretDown,
  ClockCounterClockwise,
  CaretUpDown,
  ChartLineUp,
  FlowArrow,
  Gear,
  Lightning,
  ListChecks,
  Plugs,
  Robot,
  SidebarSimple,
  SignOut,
  TreeStructure,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useEffect, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { href, isCliConfigSection, selectedConfigCli, type Route } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { useDrafts } from "../../features/config";
import { statusOf } from "../../features/tasks";
import { logout, useAuthMode } from "../../features/auth";
import { PROVIDER_IDS } from "../../shared/providers";
import { providerVersions } from "../../features/usage";
import { ThemeSelector } from "../../shared/ui/ThemeSelector";
import { BrandMark } from "../../shared/ui/BrandMark";
import "./sidebar.css";

interface NavItem {
  label: string;
  icon: Icon;
  route: Route;
  /** Config sections that keep this item active. */
  sections?: string[];
  badge?: number;
  warn?: boolean;
  /** Has unsaved edits. */
  dirty?: boolean;
}

const COLLAPSED_KEY = "taskpilot.sidebar.collapsed";

type GroupId = "workspace" | "config" | "integrations";

/**
 * How the sidebar shows: the full 248px column, the 64px icon rail (desktop, folded by the user), or
 * a drawer over the page on a narrow screen.
 */
export type SidebarMode = "full" | "rail" | "drawer";

/** Window event that folds or unfolds the sidebar (from the command palette, handled in App). */
export const TOGGLE_SIDEBAR = "taskpilot:sidebar";

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
 * App navigation in three zones: brand and repo on top, the scrolling nav (foldable groups) in the
 * middle, and the account (log out, agent versions) at the bottom. In the rail only icons show: each
 * item keeps its label for screen readers and as a tooltip, and badges sit on the icon.
 */
export function Sidebar({
  route,
  mode,
  onToggle,
  onNavigate,
  onSwitchRepo,
  toggleRef,
}: {
  route: Route;
  mode: SidebarMode;
  /** Folds/unfolds the rail, or closes the drawer. */
  onToggle: () => void;
  /** A link was followed: the drawer closes even when the page stays the same. */
  onNavigate: () => void;
  onSwitchRepo: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation(["shell", "common"]);
  const { repo, tasks, inventory, info } = useWorkspace();
  const drafts = useDrafts();
  const authMode = useAuthMode();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const cli = route.page === "config" && isCliConfigSection(route.section) ? (route.cli ?? "claude") : selectedConfigCli();
  const dirty = (prefix: string) => drafts.some((k) => k.startsWith(`${cli}:${prefix}`));
  const waiting = tasks.filter((x) => statusOf(x).tone === "attention").length;
  const inTasks = route.page === "tasks" || route.page === "task";
  const libraryCount = cli === "claude" && inventory ? inventory.claudeDir.agents + inventory.claudeDir.commands + inventory.claudeDir.skills : undefined;
  const rail = mode === "rail";
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? t("common:noRepo");

  // Every group has a visible heading; the config groups below the workspace can fold.
  const groups: Array<{ id: GroupId; label: string; foldable: boolean; items: NavItem[] }> = [
    {
      id: "workspace",
      label: t("navGroup.workspace"),
      foldable: false,
      items: [
        { label: t("nav.overview"), icon: ChartLineUp, route: { page: "overview" } },
        { label: t("nav.tasks"), icon: ListChecks, route: { page: "tasks" }, badge: waiting || undefined, warn: waiting > 0 },
        {
          label: t("nav.workflow"),
          icon: FlowArrow,
          route: { page: "config", section: "workflow" },
          sections: ["workflow", "formats"],
          dirty: drafts.some((k) => k.startsWith("workflow:")),
        },
      ],
    },
    {
      id: "config",
      label: t("navGroup.config"),
      foldable: true,
      items: [
        { label: t("nav.memory"), icon: BookOpenText, route: { page: "config", section: "memory", cli }, dirty: dirty("memory:") },
        { label: t("nav.settings"), icon: Gear, route: { page: "config", section: "settings", cli }, dirty: dirty("settings:") },
        {
          label: t("nav.hooks"),
          icon: Lightning,
          route: { page: "config", section: "hooks", cli },
          badge: cli === "claude" ? inventory?.claudeDir.hooks || undefined : undefined,
          dirty: dirty("hooks:"),
        },
        {
          label: t("nav.library"),
          icon: Robot,
          route: { page: "config", section: "agents", cli },
          sections: ["agents", "commands", "skills"],
          badge: libraryCount || undefined,
          dirty: dirty("library:"),
        },
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
          route: { page: "config", section: "mcp", cli },
          badge: cli === "claude" ? inventory?.mcp.servers.length || undefined : undefined,
          warn: cli === "claude" && Boolean(inventory?.mcp.error),
        },
        { label: t("nav.codegraph"), icon: TreeStructure, route: { page: "config", section: "codegraph" } },
      ],
    },
  ];

  // A utility page, not Claude configuration: pinned at the bottom of the nav, under every group.
  const backups: NavItem = { label: t("nav.backups"), icon: ClockCounterClockwise, route: { page: "backups" } };

  const isActive = (r: Route, sections?: string[]) => {
    if (r.page === "config") return route.page === "config" && (sections ?? [r.section]).includes(route.section);
    if (r.page === "tasks") return inTasks;
    return r.page === route.page;
  };

  // Opening a page inside a folded group unfolds it, so the current page is always in view.
  const activeGroup = groups.find((g) => g.items.some((it) => isActive(it.route, it.sections)))?.id;
  const [seenGroup, setSeenGroup] = useState<GroupId>();
  if (seenGroup !== activeGroup) {
    setSeenGroup(activeGroup);
    if (activeGroup && collapsed.includes(activeGroup)) setCollapsed(collapsed.filter((id) => id !== activeGroup));
  }

  useEffect(() => writeCollapsed(collapsed), [collapsed]);

  const toggle = (id: GroupId) => setCollapsed((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const versionLabels = providerVersions(info, t);
  const versions = PROVIDER_IDS.map((id) => versionLabels[id])
    .filter(Boolean)
    .join("\n");
  const toggleLabel = mode === "drawer" ? t("sidebar.close") : rail ? t("sidebar.expand") : t("sidebar.collapse");

  const renderItem = (it: NavItem) => {
    const active = isActive(it.route, it.sections);
    const tip = it.badge !== undefined ? `${it.label} (${it.badge})` : it.label;
    return (
      <li key={it.label}>
        <a className="nav-item" href={href(it.route)} aria-current={active ? "page" : undefined} title={rail ? tip : undefined} onClick={onNavigate}>
          {active && <motion.span className="nav-active" layoutId="nav-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          <it.icon className="nav-icon" weight={active ? "fill" : "regular"} aria-hidden="true" />
          <span className="nav-text">{it.label}</span>
          {it.dirty && <span className="nav-dirty" title={t("common:unsavedTitle")} aria-label={t("common:unsaved")} />}
          {it.badge !== undefined && <span className={`nav-badge${it.warn ? " is-warn" : ""}`}>{it.badge}</span>}
        </a>
      </li>
    );
  };

  return (
    <nav id="sidebar" className={`sidebar is-${mode}`} aria-label={t("nav.label")}>
      <div className="sidebar-head">
        <div className="brand-row">
          <a className="brand" href={href({ page: "overview" })} onClick={onNavigate} title={rail ? t("common:appName") : undefined}>
            <BrandMark />
            <span className="brand-name">{t("common:appName")}</span>
          </a>
          <button
            ref={toggleRef}
            type="button"
            className="sidebar-toggle"
            onClick={onToggle}
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={mode === "drawer" ? undefined : !rail}
          >
            {mode === "drawer" ? <X aria-hidden="true" /> : <SidebarSimple aria-hidden="true" />}
          </button>
        </div>

        <button type="button" className="repo-switch" onClick={onSwitchRepo} title={rail ? (repo?.path ?? t("repoSwitch")) : undefined}>
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
          // The rail has no room for group labels: every item shows, groups split by a line.
          const open = rail || !g.foldable || !collapsed.includes(g.id);
          const listId = `nav-group-${g.id}`;
          return (
            <div className="nav-group" key={g.id}>
              {rail ? (
                <div className="nav-divider" role="presentation">
                  <span className="sr-only">{g.label}</span>
                </div>
              ) : g.foldable ? (
                <button type="button" className="nav-label nav-toggle" aria-expanded={open} aria-controls={listId} onClick={() => toggle(g.id)}>
                  <span>{g.label}</span>
                  <CaretDown className="nav-toggle-caret" aria-hidden="true" />
                </button>
              ) : (
                <div className="nav-label">{g.label}</div>
              )}
              <ul id={listId} hidden={!open}>
                {g.items.map(renderItem)}
              </ul>
            </div>
          );
        })}
        <ul className="nav-utility">{renderItem(backups)}</ul>
      </div>

      <ThemeSelector />
      <div className="sidebar-account">
        <div className="account-versions" title={versions}>
          {PROVIDER_IDS.map((id) => versionLabels[id] && <span key={id}>{versionLabels[id]}</span>)}
        </div>
        {authMode === "password" && (
          <button type="button" className="account-logout" onClick={() => void logout()} title={rail ? t("account.logout") : undefined}>
            <SignOut aria-hidden="true" />
            <span className="account-logout-text">{t("account.logout")}</span>
          </button>
        )}
      </div>
    </nav>
  );
}
