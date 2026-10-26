import { Gauge, HandPalm, TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { PROVIDER_LABELS } from "../../shared/providers";
import { href } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { locale } from "../../i18n";
import { useRepoSessions } from "../../features/sessions";
import { useUsage, type CopilotQuota, type CodexUsage, type UsageView } from "../../features/usage";
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
}

/**
 * Claude's plan usage and Copilot's quota as one "Usage" footer button, highlighted when any meter is near its limit; the
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
        {t("status.usageLabel")}
      </button>
      {open && (
        <div className="usage-popover" id={panelId} ref={panelRef} role="dialog" aria-label={t("status.usageDialog")} tabIndex={-1}>
          <section className="usage-agent">
            <header className="usage-agent-head">
              <h2>{PROVIDER_LABELS.claude}</h2>
              <span className="usage-version">{claudeVersion}</span>
            </header>
            <p className="usage-scope">{t("status.usageTitle")}</p>
            {claude.length > 0 ? <MeterList meters={claude} /> : <p className="usage-empty">{t("status.usageEmpty")}</p>}
            {claude.length > 0 && usage.updatedAt && <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(usage.updatedAt) })}</p>}
          </section>
          {copilotQuota && copilot && (
            <section className="usage-agent">
              <header className="usage-agent-head">
                <h2>{PROVIDER_LABELS.copilot}</h2>
                {copilotVersion && <span className="usage-version">{copilotVersion}</span>}
              </header>
              <p className="usage-scope">
                {copilotQuota.unlimited ? t("status.copilotUsageUnlimited", { unit: copilotUnit(copilotQuota, t) }) : t("status.copilotUsageTitle", { unit: copilotUnit(copilotQuota, t) })}
              </p>
              <MeterList meters={[copilot]} />
              <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(copilotQuota.updatedAt) })}</p>
            </section>
          )}
          {codexUsage && codex.length > 0 && (
            <section className="usage-agent">
              <header className="usage-agent-head">
                <h2>{PROVIDER_LABELS.codex}</h2>
                {codexVersion && <span className="usage-version">{codexVersion}</span>}
              </header>
              <p className="usage-scope">{t("status.codexUsageTitle")}</p>
              <MeterList meters={codex} />
              {codexExtras(codexUsage, t).map((line) => (
                <p key={line} className="usage-updated">
                  {line}
                </p>
              ))}
              <p className="usage-updated">{t("status.usageUpdated", { time: formatTime(codexUsage.updatedAt) })}</p>
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

function hasCodexNumbers(codex: CodexUsage | undefined): boolean {
  return !!(codex && (codex.fiveHour || codex.sevenDay));
}

/** Codex's windows as it last reported them; a window it did not report is left out, not guessed. */
function codexMeters(codex: CodexUsage, t: TFunction<"shell">): Meter[] {
  const meters: Meter[] = [];
  if (codex.fiveHour) meters.push(buildMeter(t, "codex-5h", "5h", codex.fiveHour.usedPercentage, codex.fiveHour.resetsAt));
  if (codex.sevenDay) meters.push(buildMeter(t, "codex-7d", "7d", codex.sevenDay.usedPercentage, codex.sevenDay.resetsAt));
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
  if (usage.fiveHour) meters.push(buildMeter(t, "5h", "5h", usage.fiveHour.usedPercentage, usage.fiveHour.resetsAt));
  if (usage.sevenDay) meters.push(buildMeter(t, "7d", "7d", usage.sevenDay.usedPercentage, usage.sevenDay.resetsAt));
  if (usage.spend) meters.push(buildMeter(t, "spend", "spend", usage.spend.usedPercentage, null));
  return meters;
}

function copilotUnit(quota: CopilotQuota, t: TFunction<"shell">): string {
  return t(quota.unit === "ai_credits" ? "status.copilotUnitAiCredits" : "status.copilotUnitPremiumRequests");
}

/** Copilot's account quota as its runtime last reported it. */
function copilotMeter(quota: CopilotQuota, t: TFunction<"shell">): Meter {
  const unit = copilotUnit(quota, t);
  const extra = quota.used !== null && quota.entitlement !== null ? [t("status.copilotUsageUsed", { used: quota.used, entitlement: quota.entitlement, unit })] : [];
  return buildMeter(t, "copilot", unit, quota.usedPercentage, quota.resetsAt, extra);
}

/** The one Meter every agent goes through: same reset line, and a figure whose window already reset is flagged as possibly stale. */
function buildMeter(t: TFunction<"shell">, id: string, label: string, percent: number | null, resetsAt: number | null | undefined, extra: string[] = []): Meter {
  const notes = [...extra];
  if (resetsAt) {
    notes.push(t("status.usageReset", { window: label, time: formatTime(resetsAt) }));
    if (resetsAt < Date.now()) notes.push(t("status.usageStale"));
  }
  return { id, label, percent, notes };
}

/** Same rule for every agent and window: time only when it is today, time plus weekday/date otherwise. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${time} ${d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" })}`;
}
