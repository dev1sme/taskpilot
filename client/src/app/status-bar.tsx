import { HandPalm } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useTasks } from "@/features/workspace/queries";
import { cn } from "@/lib/utils";

/** Live, repo-wide counters at the bottom of every page. */
export function StatusBar() {
  const { t } = useTranslation("shell");
  const tasks = useTasks().data ?? [];
  const running = tasks.reduce((n, task) => n + task.sessionsRunning, 0);
  const asking = tasks.filter((task) => task.waitingPermission);
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-sidebar px-3 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn("size-2 rounded-full bg-line-strong", running > 0 && "animate-pulse bg-done")} />
        {t("status.sessionsRunning", { count: running })}
      </span>
      {asking.length > 0 && (
        <Link to="/tasks/$key" params={{ key: asking[0].key }} className="flex min-h-6 items-center gap-1 rounded-sm px-1 font-medium text-attention hover:underline">
          <HandPalm weight="fill" aria-hidden />
          {t("status.asking", { count: asking.length })}
        </Link>
      )}
    </footer>
  );
}
