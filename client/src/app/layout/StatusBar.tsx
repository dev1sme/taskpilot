import { Gauge, HandPalm, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AGENT_LABELS } from "../../shared/agents";
import { href } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { locale } from "../../i18n";
import { useRepoSessions } from "../../features/sessions";
import { useUsage, type AgentQuota, type CodexUsage, type UsageView } from "../../features/usage";
import "./status-bar.css";

/** Live, repo-wide counters at the bottom of every page. Log out and agent versions live in the sidebar. */
export function StatusBar(props: { terminalOpen: boolean; onToggleTerminal: (open: boolean) => void }) {
  const { t } = useTranslation("shell");
  const { repo, tasks } = useWorkspace();
  const { sessions: repoSessions } = useRepoSessions(repo?.path ?? null);
  const repoRunning = repoSessions.filter((s) => s.status === "running").length;
  const repoAsking = repoSessions.some((s) => s.activity === "permission");
  const running = tasks.reduce((n, task) => n + task.sessionsRunning, 0);
  const asking = tasks.filter((task) => task.waitingPermission);
  const usage = useUsage();

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
      {usage && (usage.fiveHour || usage.sevenDay || usage.spend || usage.agents?.copilot || hasCodexNumbers(usage.agents?.codex)) && <UsageButton usage={usage} />}
    </footer>
  );
}

/** At or above this share of a window the usage turns into a warning. */
const WARN_PERCENT = 80;

interface Meter {
  id: string;
  label: string;
  percent: number | null;
  notes: string[];
  /** Agent name shown before the first meter of a group in the summary ("Codex 5h 30% · 7d 10%"). */
  group?: string;
}

/**
 * Claude's plan usage and Copilot's quota as one footer button ("5h 42% · 7d 18% · Copilot 9%"); the
 * details (reset times, used x/y, agent versions) sit in a popover that opens on click or keyboard.
 */
function UsageButton({ usage }: { usage: UsageView }) {
  const { t } = useTranslation("shell");
  const { info } = useWorkspace();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const claude = claudeMeters(usage, t);
  const copilotQuota = usage.agents?.copilot;
  const copilot = copilotQuota ? copilotMeter(copilotQuota, t) : null;
  const codexUsage = usage.agents?.codex;
  const codex = codexUsage ? codexMeters(codexUsage, t) : [];
  const meters = [...claude, ...(copilot ? [copilot] : []), ...codex];
  const warn = meters.some((m) => m.percent !== null && m.percent >= WARN_PERCENT);
  const summary = meters.map((m, i) => (m.group && meters[i - 1]?.group === m.group ? shortLabel(m) : short(m))).join(" · ");
  // Narrow screens show only the fullest meter.
  const peak = meters.reduce((a, b) => ((b.percent ?? -1) > (a.percent ?? -1) ? b : a), meters[0]);

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

  const claudeVersion = info?.claudeVersion ? t("account.claudeVersion", { version: info.claudeVersion }) : t("account.claudeMissing");
  const copilotVersion = info?.versions?.copilot ? t("account.copilotVersion", { version: info.versions.copilot }) : null;
  const codexVersion = info?.versions?.codex ? t("account.codexVersion", { version: info.versions.codex }) : null;

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
        <span className="sr-only">{t("status.usageLabel")}</span>
        <span className="usage-summary">{summary}</span>
        <span className="usage-peak" aria-hidden="true">
          {peak && short(peak)}
        </span>
      </button>
      {open && (
        <div className="usage-popover" id={panelId} ref={panelRef} role="dialog" aria-label={t("status.usageDialog")} tabIndex={-1}>
          <section className="usage-agent">
            <header className="usage-agent-head">
              <h2>{AGENT_LABELS.claude}</h2>
              <span className="usage-version">{claudeVersion}</span>
            </header>
            <p className="usage-scope">{t("status.usageTitle")}</p>
            {claude.length > 0 ? <MeterList meters={claude} /> : <p className="usage-empty">{t("status.usageEmpty")}</p>}
            {claude.length > 0 && usage.updatedAt && <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(usage.updatedAt, true) })}</p>}
          </section>
          {copilotQuota && copilot && (
            <section className="usage-agent">
              <header className="usage-agent-head">
                <h2>{AGENT_LABELS.copilot}</h2>
                {copilotVersion && <span className="usage-version">{copilotVersion}</span>}
              </header>
              <p className="usage-scope">
                {copilotQuota.unlimited ? t("status.copilotUsageUnlimited", { unit: copilotUnit(copilotQuota, t) }) : t("status.copilotUsageTitle", { unit: copilotUnit(copilotQuota, t) })}
              </p>
              <MeterList meters={[copilot]} />
              <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(copilotQuota.updatedAt, true) })}</p>
            </section>
          )}
          {codexUsage && codex.length > 0 && (
            <section className="usage-agent">
              <header className="usage-agent-head">
                <h2>{AGENT_LABELS.codex}</h2>
                {codexVersion && <span className="usage-version">{codexVersion}</span>}
              </header>
              <p className="usage-scope">{t("status.codexUsageTitle")}</p>
              <MeterList meters={codex} />
              {codexExtras(codexUsage, t).map((line) => (
                <p key={line} className="usage-updated">
                  {line}
                </p>
              ))}
              <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(codexUsage.updatedAt, true) })}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MeterList({ meters }: { meters: Meter[] }) {
  return (
    <ul className="usage-meters">
      {meters.map((m) => {
        const warn = m.percent !== null && m.percent >= WARN_PERCENT;
        return (
          <li key={m.id} className={warn ? "is-warn" : undefined}>
            <span className="usage-meter-label">{m.label}</span>
            <span className="usage-meter-value">{m.percent === null ? "∞" : `${Math.round(m.percent)}%`}</span>
            <span className="usage-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, m.percent ?? 0)}%` }} />
            </span>
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

/** "5h 42%", "Copilot ∞", "Codex 5h 30%". */
function short(m: Meter): string {
  const label = m.id === "copilot" ? AGENT_LABELS.copilot : m.group ? `${m.group} ${m.label}` : m.label;
  return `${label} ${m.percent === null ? "∞" : `${Math.round(m.percent)}%`}`;
}

/** Same without the group prefix: "7d 10%". */
function shortLabel(m: Meter): string {
  return `${m.label} ${m.percent === null ? "∞" : `${Math.round(m.percent)}%`}`;
}

function hasCodexNumbers(codex: CodexUsage | undefined): boolean {
  return !!(codex && (codex.fiveHour || codex.sevenDay));
}

/** Codex's windows as it last reported them; a window it did not report is left out, not guessed. */
function codexMeters(codex: CodexUsage, t: TFunction<"shell">): Meter[] {
  const meters: Meter[] = [];
  const add = (id: "5h" | "7d", w: CodexUsage["fiveHour"]) => {
    if (!w) return;
    meters.push({
      id: `codex-${id}`,
      label: id,
      group: AGENT_LABELS.codex,
      percent: w.usedPercentage,
      notes: w.resetsAt ? [t("status.usageReset", { window: id, time: formatTime(w.resetsAt, id === "7d") })] : [],
    });
  };
  add("5h", codex.fiveHour);
  add("7d", codex.sevenDay);
  return meters;
}

function codexExtras(codex: CodexUsage, t: TFunction<"shell">): string[] {
  const lines: string[] = [];
  if (codex.planType) lines.push(t("status.codexPlan", { plan: codex.planType }));
  if (codex.rateLimitReachedType) lines.push(t("status.codexLimitReached", { type: codex.rateLimitReachedType }));
  const credits = codex.credits;
  if (credits) {
    if (credits.unlimited) lines.push(t("status.codexCreditsUnlimited"));
    else if (credits.hasCredits && credits.balance !== null) lines.push(t("status.codexCredits", { balance: credits.balance }));
    else if (!credits.hasCredits) lines.push(t("status.codexCreditsNone"));
  }
  return lines;
}

function claudeMeters(usage: UsageView, t: TFunction<"shell">): Meter[] {
  const meters: Meter[] = [];
  if (usage.fiveHour) {
    const reset = usage.fiveHour.resetsAt;
    meters.push({ id: "5h", label: "5h", percent: usage.fiveHour.usedPercentage, notes: reset ? [t("status.usageReset", { window: "5h", time: formatTime(reset, false) })] : [] });
  }
  if (usage.sevenDay) {
    const reset = usage.sevenDay.resetsAt;
    meters.push({ id: "7d", label: "7d", percent: usage.sevenDay.usedPercentage, notes: reset ? [t("status.usageReset", { window: "7d", time: formatTime(reset, true) })] : [] });
  }
  if (usage.spend) meters.push({ id: "spend", label: "spend", percent: usage.spend.usedPercentage, notes: [] });
  return meters;
}

function copilotUnit(quota: AgentQuota, t: TFunction<"shell">): string {
  return t(quota.unit === "ai_credits" ? "status.copilotUnitAiCredits" : "status.copilotUnitPremiumRequests");
}

/** Copilot's account quota as its runtime last reported it. */
function copilotMeter(quota: AgentQuota, t: TFunction<"shell">): Meter {
  const unit = copilotUnit(quota, t);
  const notes: string[] = [];
  if (quota.used !== null && quota.entitlement !== null) notes.push(t("status.copilotUsageUsed", { used: quota.used, entitlement: quota.entitlement, unit }));
  if (quota.resetsAt) notes.push(t("status.copilotUsageReset", { time: formatTime(quota.resetsAt, true) }));
  return { id: "copilot", label: unit, percent: quota.usedPercentage, notes };
}

function formatTime(ms: number, withDay: boolean): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return withDay ? `${time} ${d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" })}` : time;
}
