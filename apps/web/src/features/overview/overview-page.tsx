import type { McpConfig, MemoryFile, ProviderId, TaskListItem } from "@taskpilot/server/api-types";
import { ArrowRight, CheckCircle, PlayCircle, HandPalm, Stack, type Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useId, useState, type ReactNode } from "react";
import { LayoutGroup, motion, MotionConfig } from "motion/react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@taskpilot/shared";
import { useTranslation } from "react-i18next";
import { CLI_SECTIONS, lastConfigCli, rememberConfigCli } from "@/app/routes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCapabilities, useSection } from "@/features/config/queries";
import { Elapsed } from "@/components/elapsed";
import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/features/tasks/status-badge";
import { matchesFilter, sortTasks } from "@/features/tasks/status";
import { UsagePanel } from "@/features/usage/usage-panel";
import { useUsage } from "@/features/usage/queries";
import { repoName, useRepo, useTasks } from "@/features/workspace/queries";
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
  const attention = all.filter((task) => matchesFilter(task, "attention"));
  const running = all.filter((task) => matchesFilter(task, "running"));
  const idle = all.filter((task) => matchesFilter(task, "open"));
  const done = all.filter((task) => matchesFilter(task, "done")).length;

  if (!repo?.path) return <EmptyState title={t("overview.noRepo")} />;
  return (
    <MotionConfig reducedMotion="user" transition={{ type: "tween", duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex min-h-full min-w-0 flex-col">
        <PageHeader
          title={repoName(repo.path)}
          subtitle={<span className="block break-all font-mono text-xs">{repo.path}</span>}
          actions={
            <Link to="/tasks" className="flex min-h-9 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-signal-text hover:underline">
              {t("overview.allTasks")}
              <ArrowRight aria-hidden />
            </Link>
          }
        />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-6 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="grid min-w-0 content-start gap-6 sm:gap-8">
            {tasks.error ? (
              <p role="alert" className="text-sm text-danger">
                {tasks.error.message}
              </p>
            ) : !tasks.data ? (
              <p className="text-sm text-muted">{t("common:loading")}</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4">
                  <Count label={t("overview.counts.attention")} value={attention.length} icon={HandPalm} tone={attention.length > 0 ? "attention" : undefined} />
                  <Count label={t("overview.counts.running")} value={running.length} icon={PlayCircle} tone="active" />
                  <Count label={t("overview.counts.open")} value={idle.length} icon={Stack} tone="work" />
                  <Count label={t("overview.counts.done")} value={done} icon={CheckCircle} tone={done > 0 ? "done" : undefined} />
                </dl>
                {attention.length > 0 ? (
                  <Section title={t("overview.attention")} empty={t("overview.attentionEmpty")} tasks={attention} kind="attention" />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    <CheckCircle aria-hidden className="shrink-0 text-done" size={18} />
                    {t("overview.attentionEmpty")}
                  </p>
                )}
                <Section title={t("overview.running")} empty={t("overview.runningEmpty")} tasks={running} kind="active" />
                <Section title={t("overview.recent")} empty={t("overview.recentEmpty")} tasks={idle.slice(0, RECENT)} kind="work" />
              </>
            )}
          </div>
          <aside className="grid min-w-0 content-start gap-6 border-t border-line pt-6 xl:border-t-0 xl:border-l xl:border-line xl:pt-0 xl:pl-6">
            <Usage />
            <RepoConfig />
          </aside>
        </div>
      </div>
    </MotionConfig>
  );
}

function Count({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: "attention" | "active" | "work" | "done"; icon: Icon }) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-3 border-line p-4 [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:nth-child(n+2)]:border-l sm:[&:nth-child(n+3)]:border-t-0",
        tone === "attention" && "bg-attention-soft text-attention",
        tone === "active" && "bg-signal-soft text-signal-text",
        tone === "work" && "bg-cat-read/10 text-cat-read",
        tone === "done" && "text-done",
      )}
    >
      <dt className="flex items-center gap-2 text-sm font-medium">
        <Icon size={18} aria-hidden className="shrink-0" />
        {label}
      </dt>
      <dd className="font-mono text-3xl font-semibold leading-none tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, empty, tasks, kind }: { title: string; empty: string; tasks: TaskListItem[]; kind: "attention" | "active" | "work" }) {
  const highlighted = kind === "attention";
  const Icon = kind === "attention" ? HandPalm : kind === "active" ? PlayCircle : Stack;
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-lg border", highlighted ? "border-attention-line bg-attention-soft" : "border-line bg-surface")} aria-label={title}>
      <header
        className={cn(
          "flex min-w-0 items-center gap-2.5 border-b px-4 py-3 sm:px-5",
          highlighted ? "border-attention-line text-attention" : kind === "active" ? "border-line bg-signal-soft text-signal-text" : "border-line bg-cat-read/10 text-cat-read",
        )}
      >
        <Icon aria-hidden size={20} className={cn("shrink-0", kind === "active" && "text-signal-text")} />
        <h2 className="min-w-0 text-base font-semibold">{title}</h2>
        <span
          className={cn(
            "ml-auto rounded-sm px-2 py-0.5 font-mono text-sm font-semibold tabular-nums",
            highlighted ? "border border-attention-line" : kind === "active" ? "bg-signal-soft text-signal-text" : "bg-cat-read/10 text-cat-read",
          )}
        >
          {tasks.length}
        </span>
      </header>
      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted sm:px-5">{empty}</p>
      ) : (
        <ul className={cn("divide-y", highlighted ? "divide-attention-line" : "divide-line")}>
          {tasks.map((task) => (
            <motion.li key={task.key} initial="rest" whileHover="hover" whileFocus="hover">
              <TaskCard task={task} highlighted={highlighted} />
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TaskCard({ task, highlighted }: { task: TaskListItem; highlighted: boolean }) {
  const { t } = useTranslation("shell");
  const active = matchesFilter(task, "running");
  return (
    <Link
      to="/tasks/$key"
      params={{ key: task.key }}
      className={cn(
        "group grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] px-4 py-4 transition-colors duration-150 sm:px-5",
        highlighted ? "hover:bg-attention/10" : "hover:bg-hover",
      )}
    >
      <div className="grid min-w-0 gap-2">
        <h3 className="min-w-0 break-all font-mono text-xl font-semibold leading-snug underline-offset-4 group-hover:underline sm:text-2xl">{task.key}</h3>
        {task.title !== task.key && <p className={cn("min-w-0 [overflow-wrap:anywhere] text-sm leading-relaxed", highlighted ? "text-attention" : "text-muted")}>{task.title}</p>}
        <span className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
          <StatusBadge task={task} className="max-w-full whitespace-normal [&_svg]:shrink-0" />
          <span className={cn("flex flex-wrap items-center gap-2 font-mono text-xs", highlighted ? "text-attention" : "text-muted")}>
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
        </span>
      </div>
      <motion.span aria-hidden variants={{ rest: { x: 0 }, hover: { x: 3 } }} className={cn("hidden sm:block", highlighted ? "text-attention" : "text-faint")}>
        <ArrowRight size={18} />
      </motion.span>
    </Link>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3" aria-label={title}>
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
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

/** Native configuration is selected per provider; the legacy inventory only describes Claude. */
function RepoConfig() {
  const { t } = useTranslation("shell");
  const [cli, setCli] = useState<ProviderId>(lastConfigCli);
  const selectionId = useId();
  return (
    <Card title={t("overview.repo")}>
      <LayoutGroup id={selectionId}>
        <Tabs
          value={cli}
          onValueChange={(value) => {
            const next = value as ProviderId;
            setCli(next);
            rememberConfigCli(next);
          }}
          className="grid min-w-0 gap-4"
        >
          <TabsList aria-label={t("overview.provider")} className="relative isolate grid w-full min-w-0 grid-cols-3">
            {PROVIDER_IDS.map((id) => (
              <TabsTrigger key={id} value={id} className="relative z-10 min-h-10 min-w-0 justify-center px-1 data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:min-h-8">
                {cli === id && <motion.span aria-hidden layoutId="provider-selection" className="pointer-events-none absolute inset-0 rounded-sm bg-surface shadow-sm" />}
                <span className="relative">{PROVIDER_LABELS[id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {PROVIDER_IDS.map((id) => (
            <TabsContent key={id} value={id} asChild>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
                <ProviderConfig cli={id} />
              </motion.div>
            </TabsContent>
          ))}
        </Tabs>
      </LayoutGroup>
    </Card>
  );
}

function ProviderConfig({ cli }: { cli: ProviderId }) {
  const { t } = useTranslation(["shell", "config", "common"]);
  const capabilities = useCapabilities(cli);
  const memory = useSection<MemoryFile[]>("memory", cli);
  const mcp = useSection<McpConfig>("mcp", cli);
  return (
    <div className="grid min-w-0 gap-4">
      <p className="text-xs text-muted">{t("overview.configScopes")}</p>
      <div className="grid min-w-0 gap-2">
        <Link
          to="/config/$section"
          params={{ section: "memory" }}
          search={{ cli }}
          className="flex min-h-10 items-center justify-between gap-2 rounded-sm text-sm font-medium hover:text-signal-text"
        >
          {t("nav.memory")}
          <ArrowRight aria-hidden />
        </Link>
        {memory.error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {memory.error.message}
          </p>
        ) : !memory.data ? (
          <p className="text-sm text-muted">{t("common:loading")}</p>
        ) : (
          <ul className="grid min-w-0 gap-3">
            {memory.data.map((file) => (
              <li key={`${file.scope}:${file.path}`} className="grid min-w-0 gap-1">
                <span className="break-all font-mono text-xs">{file.path}</span>
                <span className="flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>{t(`config:scope.${file.scope}`)}</span>
                  <span>{file.exists ? t("overview.memoryLines", { count: file.lines }) : t("overview.memoryMissing")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid min-w-0 gap-2 border-t border-line pt-3">
        <Link
          to="/config/$section"
          params={{ section: "mcp" }}
          search={{ cli }}
          className="flex min-h-10 items-center justify-between gap-2 rounded-sm text-sm font-medium hover:text-signal-text"
        >
          {t("overview.mcp")}
          <ArrowRight aria-hidden />
        </Link>
        {mcp.error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {mcp.error.message}
          </p>
        ) : !mcp.data ? (
          <p className="text-sm text-muted">{t("common:loading")}</p>
        ) : (
          <>
            {mcp.data.sources
              .filter((source) => source.error)
              .map((source) => (
                <p key={source.path} role="alert" className="break-words text-xs text-danger">
                  {source.error}
                </p>
              ))}
            {mcp.data.servers.length === 0 ? (
              <p className="text-sm text-muted">{t("config:empty")}</p>
            ) : (
              <ul className="grid min-w-0 gap-2 text-sm">
                {mcp.data.servers.map((server, index) => (
                  <li key={`${server.scope}:${server.name}:${index}`} className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 break-all font-mono text-xs">{server.name}</span>
                    <span className="shrink-0 text-xs text-muted">{t(`config:scope.${server.scope}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <nav aria-label={t("overview.providerConfig", { provider: PROVIDER_LABELS[cli] })} className="grid border-t border-line pt-2">
        {capabilities.error ? (
          <p role="alert" className="break-words text-sm text-danger">
            {capabilities.error.message}
          </p>
        ) : !capabilities.data ? (
          <p className="text-sm text-muted">{t("common:loading")}</p>
        ) : (
          CLI_SECTIONS.filter((section) => section !== "memory" && section !== "mcp" && capabilities.data.sections[section].supported).map((section) => (
            <Link
              key={section}
              to="/config/$section"
              params={{ section }}
              search={{ cli }}
              className="flex min-h-11 items-center justify-between gap-2 rounded-sm px-2 text-sm text-muted hover:bg-hover hover:text-ink sm:min-h-9"
            >
              {t(`nav.${section}`)}
              <ArrowRight aria-hidden />
            </Link>
          ))
        )}
      </nav>
    </div>
  );
}
