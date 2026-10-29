import type { ProviderId, SessionView } from "@taskpilot/server/api-types";
import { ArrowClockwise, CaretDown, CaretUp, HandPalm, Plus, Stop, TerminalWindow, Trash } from "@phosphor-icons/react";
import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AgentBadge } from "@/components/agent-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@taskpilot/shared";
import { cn } from "@/lib/utils";
import { sessionsApi } from "./queries";
import { SessionObservationNote } from "./observation";

// xterm.js loads when a drawer first shows a terminal.
const Terminal = lazy(() => import("./terminal").then((m) => ({ default: m.Terminal })));

interface Props {
  label: string;
  /** "task" or "repo": what removing a session takes it out of. */
  scope: "task" | "repo";
  emptyHint: string;
  onCreate: (agent: ProviderId) => Promise<SessionView>;
  sessions: SessionView[];
  activeId: string | null;
  open: boolean;
  /** Sessions the active run drives; they cannot be removed while it runs. */
  runSessionIds: string[];
  onSelect: (id: string) => void;
  onToggle: (open: boolean) => void;
  onChanged: () => void;
}

/** The real agent terminal at the bottom: one bar with the session tabs, opened on demand or when an agent needs an answer. */
export function TerminalDrawer(props: Props) {
  const { t } = useTranslation("sessions");
  const bodyId = useId();
  const { sessions } = props;
  const active = sessions.find((s) => s.id === props.activeId) ?? sessions[sessions.length - 1] ?? null;
  const readOnly = Boolean(active?.retired || active?.reservation);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [generation, setGeneration] = useState(0);
  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      props.onChanged();
    }
  };
  const removable = active && !props.runSessionIds.includes(active.id);

  return (
    <section aria-label={props.label} className="shrink-0 border-t border-line bg-sidebar">
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-2 py-1.5">
        <Button variant="ghost" size="sm" aria-expanded={props.open} aria-controls={bodyId} onClick={() => props.onToggle(!props.open)}>
          <TerminalWindow weight="bold" aria-hidden />
          {props.label}
          {props.open ? <CaretDown aria-hidden /> : <CaretUp aria-hidden />}
        </Button>
        <div role="group" aria-label={t("group")} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === active?.id}
              onClick={() => {
                props.onSelect(s.id);
                setConfirmRemove(false);
                if (!props.open) props.onToggle(true);
              }}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-transparent px-2 text-xs text-muted hover:bg-hover hover:text-ink",
                s.id === active?.id && "border-line bg-surface text-ink",
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-full", s.status === "running" ? "bg-done" : "bg-line-strong")} />
              <span className="max-w-40 truncate">{s.title}</span>
              <AgentBadge agent={s.agent ?? "claude"} className="px-1.5 py-0 text-[10px]" />
              <span className="sr-only">{s.status === "running" ? t("running") : t("stopped")}</span>
              {s.retired && <span className="text-faint">{t("retired")}</span>}
              {s.reservation && <span className="text-faint">{t("reserved")}</span>}
              {s.activity === "permission" && (
                <span className="flex items-center gap-1 font-medium text-attention">
                  <HandPalm weight="fill" aria-hidden />
                  {t("waitingPermission")}
                </span>
              )}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" busy={busy === "create"} aria-label={t("new")}>
                <Plus weight="bold" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuLabel>{t("newWith")}</DropdownMenuLabel>
              {PROVIDER_IDS.map((agent) => (
                <DropdownMenuItem
                  key={agent}
                  onSelect={() =>
                    void act("create", async () => {
                      const session = await props.onCreate(agent);
                      props.onSelect(session.id);
                      props.onToggle(true);
                    })
                  }
                >
                  {t("newAgent", { agent: PROVIDER_LABELS[agent] })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {active && props.open && !readOnly && (
          <div className="flex flex-wrap items-center gap-1">
            {active.status === "running" ? (
              <Button variant="ghost" size="sm" busy={busy === "stop"} disabled={busy !== null} onClick={() => void act("stop", () => sessionsApi.stop(active.id))}>
                <Stop aria-hidden />
                {t("stop")}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  busy={busy === "resume"}
                  disabled={busy !== null}
                  onClick={() =>
                    void act("resume", async () => {
                      await sessionsApi.resume(active.id);
                      setGeneration((g) => g + 1);
                    })
                  }
                >
                  <ArrowClockwise aria-hidden />
                  {t("resume")}
                </Button>
                {removable &&
                  (confirmRemove ? (
                    <>
                      <span className="text-xs text-muted">{t("removeAsk", { scope: t(`scope.${props.scope}`) })}</span>
                      <Button variant="danger" size="sm" busy={busy === "remove"} disabled={busy !== null} onClick={() => void act("remove", () => sessionsApi.forget(active.id))}>
                        <Trash aria-hidden />
                        {t("removeConfirm")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={busy !== null} title={t("removeTitle", { scope: t(`scope.${props.scope}`) })} onClick={() => setConfirmRemove(true)}>
                      <Trash aria-hidden />
                      {t("remove")}
                    </Button>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
      {props.open && active?.observation && (
        <div className="px-3">
          <SessionObservationNote title={active.title} value={active.observation} />
        </div>
      )}
      {props.open && readOnly && (
        <p role="status" className="px-3 pb-2 text-xs text-muted">
          {t(active?.retired ? "retiredHint" : "reservedHint")}
        </p>
      )}
      {props.open && (
        <div id={bodyId} className="h-[min(45vh,28rem)] min-h-60 border-t border-line">
          {active ? (
            <Suspense fallback={<p className="p-4 text-sm text-muted">{t("opening")}</p>}>
              <Terminal key={`${active.id}-${generation}-${readOnly}`} sessionId={active.id} readOnly={readOnly} onExit={props.onChanged} />
            </Suspense>
          ) : (
            <p className="p-4 text-sm text-muted">{props.emptyHint}</p>
          )}
        </div>
      )}
    </section>
  );
}
