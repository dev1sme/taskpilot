import {
  BookOpenText,
  CaretUpDown,
  ChartLineUp,
  ClockCounterClockwise,
  FlowArrow,
  Gear,
  Lightning,
  ListChecks,
  Plugs,
  Robot,
  SidebarSimple,
  SignOut,
  TreeStructure,
  type Icon,
} from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { logout } from "@/features/auth/api";
import { useAuthMode } from "@/features/auth/auth-gate";
import { statusOf } from "@/features/tasks/status";
import { repoName, useInventory, useRepo, useTasks } from "@/features/workspace/queries";
import { cn } from "@/lib/utils";
import { isCliSection, lastConfigCli, type ConfigSection } from "./routes";
import { ThemeMenu } from "./theme-menu";

/** The full column, the icon rail (desktop, folded by the user), or the drawer on a narrow screen. */
export type SidebarMode = "full" | "rail" | "drawer";

interface NavItem {
  id: string;
  label: string;
  icon: Icon;
  to: "/" | "/tasks" | "/backups" | "/config/$section";
  section?: ConfigSection;
  /** Config sections that keep this item active. */
  sections?: ConfigSection[];
  badge?: number;
  warn?: boolean;
}

/** App navigation: brand and repo on top, the pages in the middle, theme and account at the bottom. */
export function Sidebar({ mode, onToggle, onNavigate, onSwitchRepo }: { mode: SidebarMode; onToggle: () => void; onNavigate: () => void; onSwitchRepo: () => void }) {
  const { t } = useTranslation(["shell", "common", "auth"]);
  const repo = useRepo().data;
  const tasks = useTasks().data ?? [];
  const inventory = useInventory().data;
  const authMode = useAuthMode();
  const location = useRouterState({ select: (s) => s.location });
  const rail = mode === "rail";
  const name = repoName(repo?.path) ?? t("noRepo");
  const waiting = tasks.filter((task) => statusOf(task).tone === "attention").length;
  const section = location.pathname.startsWith("/config/") ? location.pathname.split("/")[2] : null;
  const searchCli = (location.search as { cli?: string }).cli;
  const cli = section && isCliSection(section) && searchCli ? searchCli : lastConfigCli();
  const library = cli === "claude" && inventory ? inventory.claudeDir.agents + inventory.claudeDir.commands + inventory.claudeDir.skills : undefined;

  const groups: Array<{ id: string; label: string; items: NavItem[] }> = [
    {
      id: "workspace",
      label: t("navGroup.workspace"),
      items: [
        { id: "overview", label: t("nav.overview"), icon: ChartLineUp, to: "/" },
        { id: "tasks", label: t("nav.tasks"), icon: ListChecks, to: "/tasks", badge: waiting || undefined, warn: waiting > 0 },
        { id: "workflow", label: t("nav.workflow"), icon: FlowArrow, to: "/config/$section", section: "workflow", sections: ["workflow", "formats"] },
      ],
    },
    {
      id: "config",
      label: t("navGroup.config"),
      items: [
        { id: "memory", label: t("nav.memory"), icon: BookOpenText, to: "/config/$section", section: "memory" },
        { id: "settings", label: t("nav.settings"), icon: Gear, to: "/config/$section", section: "settings" },
        { id: "hooks", label: t("nav.hooks"), icon: Lightning, to: "/config/$section", section: "hooks", badge: cli === "claude" ? inventory?.claudeDir.hooks || undefined : undefined },
        { id: "library", label: t("nav.library"), icon: Robot, to: "/config/$section", section: "agents", sections: ["agents", "commands", "skills"], badge: library || undefined },
      ],
    },
    {
      id: "integrations",
      label: t("navGroup.integrations"),
      items: [
        {
          id: "mcp",
          label: t("nav.mcp"),
          icon: Plugs,
          to: "/config/$section",
          section: "mcp",
          badge: cli === "claude" ? inventory?.mcp.servers.length || undefined : undefined,
          warn: cli === "claude" && Boolean(inventory?.mcp.error),
        },
        { id: "codegraph", label: t("nav.codegraph"), icon: TreeStructure, to: "/config/$section", section: "codegraph" },
      ],
    },
  ];
  const backups: NavItem = { id: "backups", label: t("nav.backups"), icon: ClockCounterClockwise, to: "/backups" };

  const isActive = (item: NavItem) => {
    if (item.section) return section !== null && (item.sections ?? [item.section]).includes(section as ConfigSection);
    if (item.to === "/tasks") return location.pathname.startsWith("/tasks");
    return location.pathname === item.to;
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const link = (
      <Link
        to={item.to}
        params={item.section ? { section: item.section } : undefined}
        search={item.section && isCliSection(item.section) ? { cli } : undefined}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-ink [&_svg]:size-[18px] [&_svg]:shrink-0",
          active && "bg-signal-soft font-medium text-ink",
          rail && "justify-center px-0",
        )}
      >
        <item.icon weight={active ? "fill" : "regular"} aria-hidden className={active ? "text-signal" : undefined} />
        <span className={cn("truncate", rail && "sr-only")}>{item.label}</span>
        {item.badge !== undefined && (
          <span
            className={cn(
              "ml-auto rounded-full bg-sunken px-1.5 text-xs text-muted tabular-nums",
              item.warn && "bg-attention text-on-attention",
              rail && "absolute top-0.5 right-0.5 ml-0 px-1 text-[10px]",
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
    return (
      <li key={item.id}>
        {rail ? (
          <Tooltip content={item.badge !== undefined ? `${item.label} (${item.badge})` : item.label} side="right">
            {link}
          </Tooltip>
        ) : (
          link
        )}
      </li>
    );
  };

  const toggleLabel = mode === "drawer" ? t("sidebar.close") : rail ? t("sidebar.expand") : t("sidebar.collapse");

  return (
    <nav id="sidebar" aria-label={t("nav.label")} className={cn("flex h-full flex-col gap-3 bg-sidebar p-3", rail ? "w-16" : "w-62")}>
      <div className={cn("flex items-center gap-2", rail && "flex-col")}>
        <Link to="/" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm" aria-label={rail ? t("common:appName") : undefined}>
          <BrandMark />
          {!rail && <span className="truncate font-semibold">{t("common:appName")}</span>}
        </Link>
        {mode === "drawer" ? (
          // The drawer focuses this button when it opens; a tooltip there would pop up on its own.
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={toggleLabel}>
            <SidebarSimple aria-hidden />
          </Button>
        ) : (
          <Tooltip content={toggleLabel} side="right">
            <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={toggleLabel} aria-expanded={!rail}>
              <SidebarSimple aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>

      <button
        type="button"
        onClick={onSwitchRepo}
        title={rail ? (repo?.path ?? t("repoSwitch")) : undefined}
        className={cn("flex items-center gap-2.5 rounded-md border border-line bg-surface p-2 text-left hover:bg-hover", rail && "justify-center")}
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-sm bg-raised font-mono text-xs uppercase">
          {name.slice(0, 2)}
        </span>
        {!rail && (
          <>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{name}</span>
              <span className="truncate text-xs text-faint">{repo?.path ?? t("repoSwitch")}</span>
            </span>
            <CaretUpDown className="size-4 shrink-0 text-faint" aria-hidden />
          </>
        )}
      </button>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
        {groups.map((group) => (
          <div key={group.id} className="grid gap-2">
            {rail ? (
              <div role="presentation" className="mx-2 border-t border-line" />
            ) : (
              <div className="flex items-center gap-3 px-2.5 pt-2">
                <h2 className="shrink-0 font-sans text-sm font-semibold tracking-normal text-ink">{group.label}</h2>
                <span aria-hidden className="h-px min-w-3 flex-1 bg-line" />
              </div>
            )}
            <ul className="grid gap-0.5">{group.items.map(renderItem)}</ul>
          </div>
        ))}
        <ul className="mt-auto grid gap-0.5">{renderItem(backups)}</ul>
      </div>

      <div className={cn("grid gap-2 border-t border-line pt-3", rail && "justify-items-center")}>
        <ThemeMenu compact={rail} />
        {authMode === "password" && (
          <Button
            variant="ghost"
            size={rail ? "icon-sm" : "sm"}
            className={rail ? undefined : "justify-start"}
            onClick={() => void logout()}
            aria-label={rail ? t("auth:logout") : undefined}
          >
            <SignOut aria-hidden />
            {!rail && t("auth:logout")}
          </Button>
        )}
      </div>
    </nav>
  );
}
