import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
import { sessionsApi } from "./api";
import { useConversation } from "./useConversation";
import type { ConversationItem, SessionView } from "./types";
import "./conversation.css";

export function ApprovalCard({ item, sessionId, disabled = false }: { item: ConversationItem; sessionId: string; disabled?: boolean }) {
  const { t } = useTranslation("sessions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (decision: "accept" | "decline") => {
    setBusy(true);
    try {
      await sessionsApi.answer(sessionId, item.requestId!, decision);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="conversation-approval">
      <strong>{t("conversation.approval")}</strong>
      <p>{item.text}</p>
      {item.detail && <pre>{item.detail}</pre>}
      {item.status === "pending" ? (
        <div className="conversation-actions">
          <Button variant="primary" disabled={disabled || busy} onClick={() => void answer("accept")}>
            {t("conversation.accept")}
          </Button>
          <Button disabled={disabled || busy} onClick={() => void answer("decline")}>
            {t("conversation.decline")}
          </Button>
        </div>
      ) : (
        <span>{item.status && t(`conversation.status.${item.status}`)}</span>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function PendingApprovals({ sessionId }: { sessionId: string }) {
  const { items, connected } = useConversation(sessionId);
  return (
    <div className="conversation-approvals">
      {items
        .filter((i) => i.kind === "approval" && i.status === "pending")
        .map((item) => (
          <ApprovalCard key={item.id} item={item} sessionId={sessionId} disabled={!connected} />
        ))}
    </div>
  );
}

export function Conversation({ session }: { session: SessionView }) {
  const { t } = useTranslation("sessions");
  const { items, connected } = useConversation(session.id);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (log.current && following.current) log.current.scrollTop = log.current.scrollHeight;
  }, [items]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = session.status === "running";
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = () => {
    if (!text.trim() || busy || !connected || !running || session.activity === "starting") return;
    void act(async () => {
      await sessionsApi.input(session.id, text);
      setText("");
    });
  };
  return (
    <div className="conversation" aria-label={t("conversation.title")}>
      <div
        className="conversation-items"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        role="log"
        aria-label={t("conversation.messages")}
      >
        {!items.length && <p className="hint">{t("conversation.empty")}</p>}
        {items.map((item) =>
          item.kind === "approval" ? (
            <ApprovalCard key={item.id} item={item} sessionId={session.id} disabled={!connected || !running} />
          ) : (
            <article key={item.id} className={`conversation-item conversation-${item.kind}`}>
              <strong>{t(`conversation.kind.${item.kind}`)}</strong>
              {item.status && <span className="conversation-status">{t(`conversation.status.${item.status}`)}</span>}
              <p>{item.text}</p>
              {item.detail && (
                <details>
                  <summary>{t("conversation.details")}</summary>
                  <pre>{item.detail}</pre>
                </details>
              )}
            </article>
          ),
        )}
      </div>
      <form
        className="conversation-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor={`prompt-${session.id}`}>{t("conversation.prompt")}</label>
        <textarea
          id={`prompt-${session.id}`}
          rows={3}
          value={text}
          disabled={!connected || !running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <p className="hint">{t("conversation.commands")}</p>
        <div className="conversation-actions">
          <Button type="submit" variant="primary" disabled={busy || !connected || !running || !text.trim() || session.activity === "starting"}>
            {t("conversation.send")}
          </Button>
          <Button disabled={busy || !connected || !running || !["busy", "permission"].includes(session.activity ?? "")} onClick={() => void act(() => sessionsApi.interrupt(session.id))}>
            {t("conversation.interrupt")}
          </Button>
          {!connected && <span className="hint">{t("conversation.disconnected")}</span>}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
