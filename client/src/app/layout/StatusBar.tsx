import { Gauge, HandPalm, SignOut, TerminalWindow } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { AGENT_LABELS } from "../../shared/agents";
import { href } from "../../shared/router";
import { useWorkspace } from "../../features/workspace";
import { locale } from "../../i18n";
import { logout, useAuthMode } from "../../features/auth";
import { useRepoSessions } from "../../features/sessions";
import { useUsage, type AgentQuota, type UsageView } from "../../features/usage";
import "./status-bar.css";

/** Live, repo-wide counters at the bottom of every page. */
export function StatusBar(props: { terminalOpen: boolean; onToggleTerminal: (open: boolean) => void }) {
  const { t } = useTranslation("shell");
  const { repo, tasks, info } = useWorkspace();
  const { sessions: repoSessions } = useRepoSessions(repo?.path ?? null);
  const repoRunning = repoSessions.filter((s) => s.status === "running").length;
  const repoAsking = repoSessions.some((s) => s.activity === "permission");
  const running = tasks.reduce((n, task) => n + task.sessionsRunning, 0);
  const asking = tasks.filter((task) => task.waitingPermission);
  const mode = useAuthMode();
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
      {usage && (usage.fiveHour || usage.sevenDay || usage.spend) && <UsageItem usage={usage} />}
      {usage?.agents?.copilot && <CopilotUsageItem quota={usage.agents.copilot} />}
      <span className="status-item status-version">{info?.claudeVersion ? t("status.claudeVersion", { version: info.claudeVersion }) : t("status.claudeMissing")}</span>
      {/* Copilot is optional: shown only when installed. */}
      {info?.versions?.copilot && <span className="status-item status-version">{t("status.copilotVersion", { version: info.versions.copilot })}</span>}
      {mode === "password" && (
        <button type="button" className="status-item status-button status-logout" onClick={() => void logout()}>
          <SignOut aria-hidden="true" />
          {t("status.logout")}
        </button>
      )}
    </footer>
  );
}

/** At or above this share of a window the item turns into a warning. */
const WARN_PERCENT = 80;

/** Claude plan usage as the last status line reported it: "5h 42% · 7d 18%". */
function UsageItem({ usage }: { usage: UsageView }) {
  const { t } = useTranslation("shell");
  const parts: string[] = [];
  const resets: string[] = [];
  if (usage.fiveHour) {
    parts.push(`5h ${Math.round(usage.fiveHour.usedPercentage)}%`);
    if (usage.fiveHour.resetsAt) resets.push(t("status.usageReset", { window: "5h", time: formatTime(usage.fiveHour.resetsAt, false) }));
  }
  if (usage.sevenDay) {
    parts.push(`7d ${Math.round(usage.sevenDay.usedPercentage)}%`);
    if (usage.sevenDay.resetsAt) resets.push(t("status.usageReset", { window: "7d", time: formatTime(usage.sevenDay.resetsAt, true) }));
  }
  if (usage.spend) parts.push(`spend ${Math.round(usage.spend.usedPercentage)}%`);
  const max = Math.max(usage.fiveHour?.usedPercentage ?? 0, usage.sevenDay?.usedPercentage ?? 0, usage.spend?.usedPercentage ?? 0);
  const updated = usage.updatedAt ? [t("status.usageUpdated", { time: formatTime(usage.updatedAt, true) })] : [];
  const title = [t("status.usageTitle"), ...resets, ...updated].join("\n");

  return (
    <span className={`status-item status-usage${max >= WARN_PERCENT ? " is-warn" : ""}`} title={title}>
      <Gauge aria-hidden="true" />
      <span className="sr-only">{t("status.usageLabel")}</span>
      {parts.join(" · ")}
    </span>
  );
}

/** Copilot's account quota as its runtime last reported it: "Copilot 42%", or "Copilot ∞" when unlimited. */
function CopilotUsageItem({ quota }: { quota: AgentQuota }) {
  const { t } = useTranslation("shell");
  const unit = t(quota.unit === "ai_credits" ? "status.copilotUnitAiCredits" : "status.copilotUnitPremiumRequests");
  const lines = [quota.unlimited ? t("status.copilotUsageUnlimited", { unit }) : t("status.copilotUsageTitle", { unit })];
  if (quota.used !== null && quota.entitlement !== null) lines.push(t("status.copilotUsageUsed", { used: quota.used, entitlement: quota.entitlement, unit }));
  if (quota.resetsAt) lines.push(t("status.copilotUsageReset", { time: formatTime(quota.resetsAt, true) }));
  lines.push(t("status.usageUpdated", { time: formatTime(quota.updatedAt, true) }));
  const warn = quota.usedPercentage !== null && quota.usedPercentage >= WARN_PERCENT;

  return (
    <span className={`status-item status-usage status-usage-copilot${warn ? " is-warn" : ""}`} title={lines.join("\n")}>
      <Gauge aria-hidden="true" />
      <span className="sr-only">{t("status.copilotUsageLabel")}</span>
      {`${AGENT_LABELS.copilot} ${quota.usedPercentage === null ? "∞" : `${Math.round(quota.usedPercentage)}%`}`}
    </span>
  );
}

function formatTime(ms: number, withDay: boolean): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return withDay ? `${time} ${d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" })}` : time;
}
