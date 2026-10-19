import { ArrowClockwise, CaretDown, CaretUp, HandPalm, Plus, Stop, TerminalWindow, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { SessionView } from "../../api/types";
import { Button, SrOnly } from "../../components/Button";
import { Terminal } from "./Terminal";
import "./sessions.css";

interface Props {
  taskKey: string;
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
 * The real Claude terminal, tucked away at the bottom. Collapsed it is one bar with the session
 * tabs; it opens on demand (or when Claude needs an answer).
 */
export function TerminalDrawer(props: Props) {
  const { sessions } = props;
  const active = sessions.find((s) => s.id === props.activeId) ?? sessions[sessions.length - 1] ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
    <section className={`drawer${props.open ? " is-open" : ""}`} aria-label="Terminal">
      <div className="drawer-bar">
        <button
          type="button"
          className="drawer-toggle"
          aria-expanded={props.open}
          aria-controls="drawer-body"
          onClick={() => props.onToggle(!props.open)}
        >
          <TerminalWindow weight="bold" aria-hidden="true" />
          Terminal
          {props.open ? <CaretDown aria-hidden="true" /> : <CaretUp aria-hidden="true" />}
        </button>

        <div className="drawer-sessions" role="group" aria-label="Session">
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
              <SrOnly>{s.status === "running" ? ", đang chạy" : ", đã dừng"}</SrOnly>
              {s.activity === "permission" && (
                <span className="drawer-flag">
                  <HandPalm weight="fill" aria-hidden="true" />
                  chờ quyền
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="drawer-add"
            disabled={busy === "create"}
            onClick={() =>
              void act("create", async () => {
                const s = await api.createSession(props.taskKey);
                props.onSelect(s.id);
                props.onToggle(true);
              })
            }
          >
            <Plus weight="bold" aria-hidden="true" />
            <SrOnly>Session mới</SrOnly>
          </button>
        </div>

        {active && props.open && (
          <div className="drawer-actions">
            {active.status === "running" ? (
              <Button icon={Stop} variant="quiet" busy={busy === "stop"} onClick={() => void act("stop", () => api.stopSession(active.id))}>
                Dừng
              </Button>
            ) : (
              <>
                <Button
                  icon={ArrowClockwise}
                  variant="primary"
                  busy={busy === "resume"}
                  onClick={() =>
                    void act("resume", async () => {
                      await api.resumeSession(active.id);
                      setGeneration((g) => g + 1);
                    })
                  }
                >
                  Resume
                </Button>
                {active.id !== props.runSessionId &&
                  (confirmRemove ? (
                    <Button
                      icon={Trash}
                      variant="danger"
                      busy={busy === "remove"}
                      onClick={() => void act("remove", () => api.forgetSession(active.id))}
                    >
                      Xoá khỏi task
                    </Button>
                  ) : (
                    <Button icon={Trash} variant="quiet" onClick={() => setConfirmRemove(true)}>
                      Xoá
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
            id="drawer-body"
            className="drawer-body"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            {active ? (
              <Terminal key={`${active.id}-${generation}`} sessionId={active.id} onExit={props.onChanged} />
            ) : (
              <p className="hint drawer-empty">Chưa có session. Bắt đầu quy trình hoặc bấm + để mở một session Claude.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
