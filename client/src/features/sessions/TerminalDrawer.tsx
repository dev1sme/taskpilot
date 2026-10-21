import { ArrowClockwise, CaretDown, CaretUp, HandPalm, Plus, Stop, TerminalWindow, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AGENT_LABELS, AGENTS, type Agent } from "../../shared/agents";
import { AgentBadge } from "../../shared/ui/AgentBadge";
import { Button, SrOnly } from "../../shared/ui/Button";
import "./sessions.css";
import { sessionsApi } from "./api";
import type { SessionView } from "./types";

// xterm.js is loaded when the drawer first opens.
const Terminal = lazy(() => import("./Terminal").then((m) => ({ default: m.Terminal })));

interface Props {
  /** Toggle text and section name; tells the repo terminal from a task's on the task screen. */
  label?: string;
  /** What a removed session leaves, for the remove button's tooltip: "task", "repo". */
  scopeLabel: string;
  /** Hint shown while there is no session yet. */
  emptyHint: string;
  /** Starts a new session of `agent` in this drawer's scope. */
  onCreate: (agent: Agent) => Promise<SessionView>;
  sessions: SessionView[];
  activeId: string | null;
  open: boolean;
  /** Session driven by the workflow run; it cannot be removed while the run is active. */
  runSessionId: string | null;
  onSelect: (id: string) => void;
  onToggle: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * The real agent terminal, tucked away at the bottom. Collapsed it is one bar with the session
 * tabs; it opens on demand (or when the agent needs an answer).
 */
export function TerminalDrawer(props: Props) {
  const { t } = useTranslation("sessions");
  const { sessions } = props;
  const active = sessions.find((s) => s.id === props.activeId) ?? sessions[sessions.length - 1] ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const menuId = useId();
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();
  const label = props.label ?? t("terminal");

  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      props.onChanged();
    }
  };

  return (
    <section className={`drawer${props.open ? " is-open" : ""}`} aria-label={label}>
      <div className="drawer-bar">
        <button
          type="button"
          className="drawer-toggle"
          aria-expanded={props.open}
          aria-controls={bodyId}
          onClick={() => props.onToggle(!props.open)}
        >
          <TerminalWindow weight="bold" aria-hidden="true" />
          {label}
          {props.open ? <CaretDown aria-hidden="true" /> : <CaretUp aria-hidden="true" />}
        </button>

        <div className="drawer-sessions" role="group" aria-label={t("group")}>
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`drawer-session${s.id === active?.id ? " is-active" : ""}`}
              aria-pressed={s.id === active?.id}
              onClick={() => {
                props.onSelect(s.id);
                setConfirmRemove(false);
                if (!props.open) props.onToggle(true);
              }}
            >
              <span className={`session-dot ${s.status}`} aria-hidden="true" />
              {s.title}
              <AgentBadge agent={s.agent} />
              <SrOnly>{s.status === "running" ? t("running") : t("stopped")}</SrOnly>
              {s.activity === "permission" && (
                <span className="drawer-flag">
                  <HandPalm weight="fill" aria-hidden="true" />
                  {t("waitingPermission")}
                </span>
              )}
            </button>
          ))}
          <div
            className="drawer-add-wrap"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setChoosing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setChoosing(false);
            }}
          >
            <button
              type="button"
              className="drawer-add"
              disabled={busy === "create"}
              aria-expanded={choosing}
              aria-controls={menuId}
              onClick={() => setChoosing((c) => !c)}
            >
              <Plus weight="bold" aria-hidden="true" />
              <SrOnly>{t("new")}</SrOnly>
            </button>
            {choosing && (
              <div id={menuId} className="drawer-add-menu" role="group" aria-label={t("newWith")}>
                {AGENTS.map((agent) => (
                  <button
                    key={agent}
                    type="button"
                    autoFocus={agent === AGENTS[0]}
                    onClick={() => {
                      setChoosing(false);
                      void act("create", async () => {
                        const s = await props.onCreate(agent);
                        props.onSelect(s.id);
                        props.onToggle(true);
                      });
                    }}
                  >
                    {t("newAgent", { agent: AGENT_LABELS[agent] })}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {active && props.open && (
          <div className="drawer-actions">
            {active.status === "running" ? (
              <Button icon={Stop} variant="quiet" busy={busy === "stop"} onClick={() => void act("stop", () => sessionsApi.stopSession(active.id))}>
                {t("stop")}
              </Button>
            ) : (
              <>
                <Button
                  icon={ArrowClockwise}
                  variant="primary"
                  busy={busy === "resume"}
                  onClick={() =>
                    void act("resume", async () => {
                      await sessionsApi.resumeSession(active.id);
                      setGeneration((g) => g + 1);
                    })
                  }
                >
                  {t("resume")}
                </Button>
                {active.id !== props.runSessionId &&
                  (confirmRemove ? (
                    <Button
                      icon={Trash}
                      variant="danger"
                      busy={busy === "remove"}
                      title={t("removeTitle", { scope: props.scopeLabel })}
                      onClick={() => void act("remove", () => sessionsApi.forgetSession(active.id))}
                    >
                      {t("removeConfirm")}
                    </Button>
                  ) : (
                    <Button icon={Trash} variant="quiet" title={t("removeTitle", { scope: props.scopeLabel })} onClick={() => setConfirmRemove(true)}>
                      {t("remove")}
                    </Button>
                  ))}
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="error drawer-error" role="alert">
          {error}
        </p>
      )}

      <AnimatePresence initial={false}>
        {props.open && (
          <motion.div
            id={bodyId}
            className="drawer-body"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            {active ? (
              <Suspense fallback={<p className="hint drawer-empty">{t("opening")}</p>}>
                <Terminal key={`${active.id}-${generation}`} sessionId={active.id} onExit={props.onChanged} />
              </Suspense>
            ) : (
              <p className="hint drawer-empty">{props.emptyHint}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
