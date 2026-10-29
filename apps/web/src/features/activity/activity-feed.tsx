import type { ActivityItem, SessionView } from "@taskpilot/server/api-types";
import { SessionObservationNote } from "@/features/sessions/observation";
import {
  BookOpenText,
  ChatCircleText,
  CircleNotch,
  Globe,
  HandPalm,
  ListChecks,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimpleLine,
  Power,
  Robot,
  TerminalWindow,
  WarningCircle,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineCode } from "@/components/markdown";
import { call } from "@/lib/api";
import { useInvalidateOn } from "@/lib/events";
import { clockTime, formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { taskUrl } from "@/features/workspace/queries";

type Category = NonNullable<ActivityItem["category"]>;

const CATEGORY: Record<Category, { icon: Icon; color: string }> = {
  read: { icon: BookOpenText, color: "text-cat-read" },
  write: { icon: PencilSimpleLine, color: "text-cat-write" },
  run: { icon: TerminalWindow, color: "text-cat-run" },
  search: { icon: MagnifyingGlass, color: "text-cat-search" },
  web: { icon: Globe, color: "text-cat-web" },
  agent: { icon: Robot, color: "text-cat-agent" },
  plan: { icon: ListChecks, color: "text-cat-plan" },
  other: { icon: Wrench, color: "text-cat-other" },
};

/** Activity of every session of the task, oldest first; refetched on live "activity" events. */
export function useActivity(taskKey: string): ActivityItem[] {
  const queryKey = ["activity", taskKey];
  useInvalidateOn("activity", queryKey, taskKey);
  return useQuery({ queryKey, queryFn: () => call<ActivityItem[]>("GET", `${taskUrl(taskKey)}/activity`) }).data ?? [];
}

const VISIBLE = 60;

/** Live log of what the agents did, newest first; prompts and turn ends read as section markers. */
export function ActivityFeed({ items, observations = [] }: { items: ActivityItem[]; observations?: Pick<SessionView, "id" | "title" | "observation">[] }) {
  const { t } = useTranslation("activity");
  const [showAll, setShowAll] = useState(false);
  const newest = [...items].reverse();
  const shown = showAll ? newest : newest.slice(0, VISIBLE);
  return (
    <section aria-labelledby="activity-title" className="grid gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="activity-title" className="text-sm font-semibold">
          {t("title")}
        </h2>
        <span className="text-xs text-faint">{t("count", { count: items.filter((i) => i.kind === "tool").length })}</span>
      </header>
      {observations.map((session) => session.observation && <SessionObservationNote key={session.id} title={session.title} value={session.observation} />)}
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ol className="grid gap-0.5">
          {shown.map((item) => (
            <li key={item.id}>
              <Row item={item} />
            </li>
          ))}
        </ol>
      )}
      {!showAll && newest.length > VISIBLE && (
        <button type="button" onClick={() => setShowAll(true)} className="justify-self-start rounded-sm px-1 py-1 text-sm text-signal-text hover:underline">
          {t("more", { count: newest.length - VISIBLE })}
        </button>
      )}
    </section>
  );
}

function Time({ at }: { at: number }) {
  return <time className="ml-auto shrink-0 font-mono text-[11px] text-faint">{clockTime(at)}</time>;
}

function Row({ item }: { item: ActivityItem }) {
  const { t } = useTranslation("activity");
  if (item.kind === "prompt" || item.kind === "session") {
    const Glyph = item.kind === "prompt" ? PaperPlaneTilt : Power;
    return (
      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-xs font-medium text-muted">
        <Glyph weight="bold" className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{item.summary}</span>
        <Time at={item.at} />
      </div>
    );
  }
  if (item.kind === "stop") {
    return (
      <div className="flex gap-2 rounded-sm bg-sunken p-2 text-sm">
        <ChatCircleText weight="fill" className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        <div className="min-w-0">
          <span className="text-xs font-medium text-muted">{t("stop")}</span>
          <p className="line-clamp-3">
            <InlineCode text={item.summary} />
          </p>
        </div>
        <Time at={item.at} />
      </div>
    );
  }
  if (item.kind === "permission") {
    return (
      <div className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm text-attention">
        <HandPalm weight="fill" className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{item.summary}</span>
        <Time at={item.at} />
      </div>
    );
  }
  const category = CATEGORY[item.category ?? "other"];
  return (
    <details className="group rounded-sm">
      <summary className="flex min-h-7 items-center gap-2 rounded-sm px-1 text-sm hover:bg-hover [&::-webkit-details-marker]:hidden">
        <category.icon weight="bold" className={cn("size-4 shrink-0", category.color)} aria-hidden />
        <span className="min-w-0 truncate">{item.summary}</span>
        {item.status === "running" && <CircleNotch className="size-3.5 shrink-0 animate-spin text-signal" aria-label={t("running")} />}
        {item.status === "error" && <WarningCircle weight="fill" className="size-3.5 shrink-0 text-danger" aria-label={t("error")} />}
        {item.durationMs !== undefined && <span className="shrink-0 font-mono text-[11px] text-faint">{formatDuration(item.durationMs)}</span>}
        <Time at={item.at} />
      </summary>
      {item.detail && <pre className="my-1 max-h-60 overflow-auto rounded-sm bg-sunken p-2 font-mono text-xs whitespace-pre-wrap">{item.detail}</pre>}
    </details>
  );
}
