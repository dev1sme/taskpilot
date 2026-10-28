import type { Inventory, TaskListItem } from "@taskpilot/server/api-types";
import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ConfigSection } from "@/app/routes";
import { Elapsed } from "@/components/elapsed";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/features/tasks/status-badge";
import { sortTasks, statusOf } from "@/features/tasks/status";
import { UsagePanel } from "@/features/usage/usage-panel";
import { useUsage } from "@/features/usage/queries";
import { repoName, useInventory, useRepo, useTasks } from "@/features/workspace/queries";
import { clockTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Tasks shown under "in progress": enough to pick one up, the task list has the rest. */
const RECENT = 5;

/**
 * The start page: what needs the user, then what is running, then work left half done. The repo's
 * agent configuration and the account usage sit on the side, since they rarely need action.
 */
export function OverviewPage() {
  const { t } = useTranslation(["shell", "common"]);
  const repo = useRepo().data;
  const tasks = useTasks();
  const all = sortTasks(tasks.data ?? []);
  const attention = all.filter((task) => statusOf(task).tone === "attention");
  const running = all.filter((task) => statusOf(task).tone === "active");
  const idle = all.filter((task) => statusOf(task).tone === "idle");
  const done = all.filter((task) => statusOf(task).tone === "done").length;

  if (!repo?.path) return <EmptyState title={t("overview.noRepo")} />;
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={repoName(repo.path)}
        subtitle={<span className="font-mono text-xs">{repo.path}</span>}
        actions={
          <Link to="/tasks" className="flex min-h-9 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-signal-text hover:underline">
            {t("overview.allTasks")}
            <ArrowRight aria-hidden />
          </Link>
        }
      />
      <div className="grid gap-6 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Count label={t("overview.counts.attention")} value={attention.length} tone={attention.length > 0 ? "attention" : undefined} />
            <Count label={t("overview.counts.running")} value={running.length} />
            <Count label={t("overview.counts.open")} value={idle.length} />
            <Count label={t("overview.counts.done")} value={done} />
          </dl>
          {tasks.error ? (
            <p role="alert" className="text-sm text-danger">
              {tasks.error.message}
            </p>
          ) : !tasks.data ? (
            <p className="text-sm text-muted">{t("common:loading")}</p>
          ) : (
            <>
              <Section title={t("overview.attention")} empty={t("overview.attentionEmpty")} tasks={attention} />
              <Section title={t("overview.running")} empty={t("overview.runningEmpty")} tasks={running} />
              <Section title={t("overview.recent")} empty={t("overview.recentEmpty")} tasks={idle.slice(0, RECENT)} />
            </>
          )}
        </div>
        <aside className="grid content-start gap-4">
          <Usage />
          <RepoConfig />
        </aside>
      </div>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "attention" }) {
  return (
    <div className={cn("grid gap-0.5 rounded-md border border-line bg-surface px-3 py-2.5", tone === "attention" && "border-attention-line bg-attention-soft")}>
      <dt className={cn("text-xs text-muted", tone === "attention" && "text-attention")}>{label}</dt>
      <dd className={cn("font-mono text-2xl font-semibold tabular-nums", tone === "attention" && "text-attention")}>{value}</dd>
    </div>
  );
}

function Section({ title, empty, tasks }: { title: string; empty: string; tasks: TaskListItem[] }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-sm font-semibold">
        {title} {tasks.length > 0 && <span className="font-normal text-faint tabular-nums">· {tasks.length}</span>}
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1.5">
          {tasks.map((task) => (
            <li key={task.key}>
              <TaskCard task={task} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskCard({ task }: { task: TaskListItem }) {
  const { t } = useTranslation("shell");
  const active = statusOf(task).tone === "active";
  return (
    <Link
      to="/tasks/$key"
      params={{ key: task.key }}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-3 py-2.5 hover:border-line-strong hover:bg-hover sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <StatusBadge task={task} className="col-start-1 row-start-1 justify-self-start" />
      <span className="col-span-2 row-start-2 flex min-w-0 items-baseline gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="shrink-0 font-mono text-sm">{task.key}</span>
        {task.title !== task.key && <span className="truncate text-sm text-muted">{task.title}</span>}
      </span>
      <span className="col-start-2 row-start-1 flex items-center gap-2 justify-self-end font-mono text-xs text-muted sm:col-start-3">
        {active && task.run ? (
          <>
            <span>{t("overview.step", { n: task.run.stepIndex + 1 })}</span>
            <Elapsed since={task.run.stepStartedAt} />
          </>
        ) : (
          clockTime(task.updatedAt)
        )}
        {task.sessionsRunning > 0 && !active && <span>{t("overview.sessions", { count: task.sessionsRunning })}</span>}
      </span>
    </Link>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-4" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Usage() {
  const { t } = useTranslation("shell");
  const usage = useUsage().data;
  return (
    <Card title={t("overview.usage")}>
      <UsagePanel usage={usage} heading={false} />
    </Card>
  );
}

/** What the repo gives Claude: memory, MCP servers, library, hooks and permissions, each a link to its page. */
function RepoConfig() {
  const { t } = useTranslation("shell");
  const inventory = useInventory().data;
  if (!inventory) return null;
  const { claudeMd, claudeLocalMd, mcp, claudeDir } = inventory;
  const rows: Array<[string, ReactNode, ConfigSection]> = [
    [t("overview.memory"), claudeMd.exists ? t("overview.memoryLines", { count: claudeMd.lines }) : t("overview.memoryMissing"), "memory"],
    [t("overview.localMemory"), claudeLocalMd ? "✓" : t("overview.memoryMissing"), "memory"],
    [t("overview.mcp"), mcp.error ? <span className="text-danger">{t("overview.mcpError")}</span> : mcpNames(mcp), "mcp"],
    [t("overview.agents"), claudeDir.agents, "agents"],
    [t("overview.commands"), claudeDir.commands, "commands"],
    [t("overview.skills"), claudeDir.skills, "skills"],
    [t("overview.hooks"), claudeDir.hooks, "hooks"],
    [t("overview.permissions"), t("overview.allowDeny", { allow: claudeDir.allow, deny: claudeDir.deny }), "settings"],
  ];
  return (
    <Card title={t("overview.repo")}>
      <dl className="grid gap-0.5 text-sm">
        {rows.map(([label, value, section]) => (
          <Link key={label} to="/config/$section" params={{ section }} search={{ cli: "claude" }} className="-mx-2 flex min-h-8 items-center gap-3 rounded-sm px-2 hover:bg-hover">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className="ml-auto min-w-0 truncate text-right font-mono text-xs">{value}</dd>
          </Link>
        ))}
      </dl>
    </Card>
  );
}

const mcpNames = (mcp: Inventory["mcp"]) => (mcp.servers.length ? mcp.servers.map((s) => s.name).join(", ") : "0");
