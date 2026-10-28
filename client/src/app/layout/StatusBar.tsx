import { Gauge, HandPalm, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { href } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { useRepoSessions } from "../../features/sessions";
import { useUsage, presentUsage, type UsageMeter, type UsageGroup } from "../../features/usage";
import "./status-bar.css";

/** Live, repo-wide counters at the bottom of every page. Log out and agent versions live in the sidebar. */
export function StatusBar(props: { terminalOpen: boolean; onToggleTerminal: (open: boolean) => void }) {
  const { t } = useTranslation("shell");
  const { repo, tasks, info } = useWorkspace();
  const { sessions: repoSessions } = useRepoSessions(repo?.path ?? null);
  const repoRunning = repoSessions.filter((s) => s.status === "running").length;
  const repoAsking = repoSessions.some((s) => s.activity === "permission");
  const running = tasks.reduce((n, task) => n + task.sessionsRunning, 0);
  const asking = tasks.filter((task) => task.waitingPermission);
  const usage = useUsage();
  const presentation = presentUsage(usage, info, t);

  return (
    <footer className="status-bar">
      {repo?.path && (
        <button
          type="button"
          className={`status-item status-button status-terminal${repoAsking ? " is-warn" : ""}`}
          aria-expanded={props.terminalOpen}
          title={t("status.terminalTitle")}
          onClick={() => props.onToggleTerminal(!props.terminalOpen)}
        >
          <TerminalWindow weight="bold" aria-hidden="true" />
          {t("status.terminal")}
          {repoRunning > 0 && <span className="status-count">{repoRunning}</span>}
          {repoAsking && (
            <>
              <HandPalm weight="fill" aria-hidden="true" />
              {t("status.waitingPermission")}
            </>
          )}
        </button>
      )}
      <span className="status-item">
        <span className={`status-dot${running > 0 ? " is-live" : ""}`} aria-hidden="true" />
        {t("status.sessionsRunning", { count: running })}
      </span>
      {asking.length > 0 && (
        <a className="status-item is-warn" href={href({ page: "task", key: asking[0].key })}>
          <HandPalm weight="fill" aria-hidden="true" />
          {t("status.asking", { count: asking.length })}
        </a>
      )}
      {presentation.visible && <UsageButton groups={presentation.groups} warn={presentation.warn} />}
    </footer>
  );
}

/** Shared rendering and popover interaction; native presentation belongs to the usage feature. */
function UsageButton({ groups, warn }: { groups: UsageGroup[]; warn: boolean }) {
  const { t } = useTranslation("shell");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      className="status-usage-root"
      ref={rootRef}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        className={`status-item status-button status-usage${warn ? " is-warn" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge aria-hidden="true" />
        {t("status.usageLabel")}
      </button>
      {open && (
        <div
          className="usage-popover"
          style={{ maxHeight: "calc(100dvh - 80px)", overflowY: "auto" }}
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={t("status.usageDialog")}
          tabIndex={-1}
        >
          {groups.map((group) => (
            <section className="usage-agent" key={group.id}>
              <header className="usage-agent-head">
                <h2>{group.label}</h2>
                {group.version && <span className="usage-version">{group.version}</span>}
              </header>
              <p className="usage-scope">{group.scope}</p>
              {group.meters.length ? <MeterList meters={group.meters} /> : <p className="usage-empty">{group.empty}</p>}
              {group.notes.map((line) => (
                <p key={line} className="usage-updated">
                  {line}
                </p>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MeterList({ meters }: { meters: UsageMeter[] }) {
  return (
    <ul className="usage-meters">
      {meters.map((m) => {
        const warn = m.warn;
        return (
          <li key={m.id} className={warn ? "is-warn" : undefined}>
            <span className="usage-meter-label">{m.label}</span>
            <span className="usage-meter-value">{m.value}</span>
            {m.percent !== null && (
              <span className="usage-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, m.percent ?? 0)}%` }} />
              </span>
            )}
            {m.notes.map((note) => (
              <span key={note} className="usage-meter-note">
                {note}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}
