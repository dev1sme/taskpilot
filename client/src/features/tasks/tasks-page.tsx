import type { TaskListItem } from "@server/api-types";
import { ArrowUUpLeft, CheckCircle, MagnifyingGlass, X } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip } from "@/components/ui/tooltip";
import { useRepo, useTasks } from "@/features/workspace/queries";
import { clockTime } from "@/lib/time";
import { stored } from "@/lib/use-media";
import { useSetTaskDone } from "./queries";
import { fold, matchesFilter, runActive, sortTasks, statusOf, type TaskFilter } from "./status";
import { StatusBadge } from "./status-badge";

const FILTERS: TaskFilter[] = ["open", "attention", "running", "done", "all"];
const FILTER_KEY = "taskpilot.tasks.filter";

const storedFilter = (): TaskFilter => {
  const value = stored.get(FILTER_KEY);
  return FILTERS.includes(value as TaskFilter) ? (value as TaskFilter) : "open";
};

/** Every task of the repo: search, quick filters, needs-you first and done last. */
export function TasksPage() {
  const { t } = useTranslation("tasks");
  const repo = useRepo().data;
  const tasks = useTasks().data ?? [];
  const [filter, setFilter] = useState<TaskFilter>(storedFilter);
  const [search, setSearch] = useState("");

  const pick = (next: string) => {
    if (!next) return;
    setFilter(next as TaskFilter);
    stored.set(FILTER_KEY, next);
  };
  const query = fold(search.trim());
  const matchesSearch = (task: TaskListItem) => !query || fold(`${task.key} ${task.title}`).includes(query);
  const shown = sortTasks(tasks).filter((task) => matchesFilter(task, filter) && matchesSearch(task));

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle", { count: tasks.length })} />
      {repo?.tasksDirExists && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
          <div className="relative w-full sm:w-72">
            <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("page.search.placeholder")} aria-label={t("page.search.label")} className="pl-9" />
          </div>
          <ToggleGroup type="single" value={filter} onValueChange={pick} aria-label={t("page.filter.label")}>
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f} value={f}>
                {t(`page.filter.${f}`)}
                <span className="rounded-full bg-sunken px-1.5 text-xs text-muted tabular-nums">{tasks.filter((task) => matchesFilter(task, f) && matchesSearch(task)).length}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      {!repo?.tasksDirExists ? (
        <EmptyState title={t("page.emptyTitle")}>
          <Trans t={t} i18nKey="page.emptyBody" values={{ taskKey: t("page.taskKeyPlaceholder") }} components={{ code: <code /> }} />
        </EmptyState>
      ) : shown.length === 0 ? (
        query ? (
          <EmptyState
            title={t("page.search.emptyTitle", { query: search.trim() })}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => setSearch("")}>
                  <X aria-hidden />
                  {t("page.search.clear")}
                </Button>
                {filter !== "all" && (
                  <Button variant="ghost" onClick={() => pick("all")}>
                    {t("page.search.showAll")}
                  </Button>
                )}
              </div>
            }
          >
            {t("page.search.emptyBody")}
          </EmptyState>
        ) : (
          <EmptyState title={t(`page.filterEmpty.${filter}.title`)}>{t(`page.filterEmpty.${filter}.body`)}</EmptyState>
        )
      ) : (
        <TaskList tasks={shown} />
      )}
    </div>
  );
}

/** A table on wide screens; on phones each row stacks: status with the key, then the title. */
function TaskList({ tasks }: { tasks: TaskListItem[] }) {
  const { t } = useTranslation("tasks");
  return (
    <div role="table" aria-label={t("page.title")} className="px-2 py-2 sm:px-4">
      <div role="rowgroup" className="hidden md:block">
        <div role="row" className="grid grid-cols-[10rem_minmax(0,1fr)_8rem_10rem] gap-4 px-3 py-2 text-xs font-medium text-faint">
          <span role="columnheader">{t("page.col.status")}</span>
          <span role="columnheader">{t("page.col.task")}</span>
          <span role="columnheader">{t("page.col.updated")}</span>
          <span role="columnheader" className="sr-only">
            {t("page.col.actions")}
          </span>
        </div>
      </div>
      <div role="rowgroup" className="grid gap-1">
        {tasks.map((task) => (
          <TaskRow key={task.key} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskListItem }) {
  const status = statusOf(task);
  return (
    <div
      role="row"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md border border-transparent px-3 py-2.5 hover:border-line hover:bg-surface md:grid-cols-[10rem_minmax(0,1fr)_8rem_10rem] md:gap-4"
    >
      <span role="cell" className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 md:col-auto md:row-auto">
        <StatusBadge task={task} />
        <span className="truncate font-mono text-xs text-muted md:hidden">{task.key}</span>
      </span>
      <span role="cell" className="col-span-2 row-start-2 min-w-0 md:col-auto md:row-auto">
        <Link to="/tasks/$key" params={{ key: task.key }} className="flex min-w-0 items-baseline gap-2 rounded-sm hover:text-signal-text">
          <span className="hidden shrink-0 font-mono text-sm md:inline">{task.key}</span>
          <span className="line-clamp-2 text-sm md:truncate md:text-muted">{task.title === task.key ? null : task.title}</span>
        </Link>
      </span>
      <span role="cell" className="hidden font-mono text-xs text-muted md:block">
        {clockTime(task.updatedAt)}
      </span>
      <span role="cell" className="col-start-2 row-start-1 justify-self-end md:col-auto md:row-auto">
        <DoneButton task={task} done={status.kind === "done"} />
      </span>
    </div>
  );
}

/** Mark done or reopen; disabled while a run is active, since the server refuses it then. */
function DoneButton({ task, done }: { task: TaskListItem; done: boolean }) {
  const { t } = useTranslation("tasks");
  const setDone = useSetTaskDone();
  const active = runActive(task);
  const button = (
    <Button
      variant="ghost"
      size="sm"
      busy={setDone.isPending}
      disabled={active}
      aria-label={done ? t("page.action.reopenLabel", { key: task.key }) : t("page.action.markDoneLabel", { key: task.key })}
      onClick={() => setDone.mutate({ key: task.key, done: !done }, { onError: (e) => toast.error(e.message) })}
    >
      {done ? <ArrowUUpLeft aria-hidden /> : <CheckCircle aria-hidden />}
      <span className="hidden sm:inline">{done ? t("page.action.reopen") : t("page.action.markDone")}</span>
    </Button>
  );
  // A disabled button gets no pointer events; the wrapper carries the reason.
  return active ? (
    <Tooltip content={t("page.action.blocked")}>
      <span tabIndex={0} className="inline-flex rounded-sm">
        {button}
      </span>
    </Tooltip>
  ) : (
    button
  );
}
