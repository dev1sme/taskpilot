import type { TFunction } from "i18next";
import { locale } from "../../i18n";
import { PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from "../../shared/providers";
import type { CopilotQuota, CodexUsage, UsageView } from "./types";

export interface UsageMeter {
  id: string;
  label: string;
  percent: number | null;
  value: string;
  warn: boolean;
  notes: string[];
}

export interface UsageGroup {
  id: ProviderId;
  label: string;
  version: string | null;
  scope: string;
  meters: UsageMeter[];
  empty?: string;
  notes: string[];
}

type VersionInfo = { claudeVersion: string | null; versions?: Partial<Record<ProviderId, string | null>> };
const versionKeys = { claude: "account.claudeVersion", copilot: "account.copilotVersion", codex: "account.codexVersion" } as const;

/** A present null in versions is authoritative; the legacy field only fills an absent Claude key. */
export function providerVersions(info: VersionInfo | null, t: TFunction<"shell">): Record<ProviderId, string | null> {
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => {
      const version = id === "claude" && info?.versions?.claude === undefined ? info?.claudeVersion : info?.versions?.[id];
      return [id, version ? t(versionKeys[id], { version }) : id === "claude" ? t("account.claudeMissing") : null];
    }),
  ) as Record<ProviderId, string | null>;
}

type NativeGroup = Omit<UsageGroup, "id" | "label" | "version">;
const adapters: Record<ProviderId, (usage: UsageView, t: TFunction<"shell">) => NativeGroup | null> = {
  claude: (usage, t) => {
    const meters = claudeMeters(usage, t);
    return { scope: t("status.usageTitle"), meters, empty: t("status.usageEmpty"), notes: meters.length && usage.updatedAt != null ? [updated(usage.updatedAt, t)] : [] };
  },
  copilot: (usage, t) => {
    const quota = usage.agents?.copilot;
    return quota
      ? {
          scope: t(quota.unlimited ? "status.copilotUsageUnlimited" : "status.copilotUsageTitle", { unit: copilotUnit(quota, t) }),
          meters: [copilotMeter(quota, t)],
          notes: [updated(quota.updatedAt, t)],
        }
      : null;
  },
  codex: (usage, t) => {
    const codex = usage.agents?.codex;
    if (!codex) return null;
    const meters = codexMeters(codex, t);
    return meters.length ? { scope: t("status.codexUsageTitle"), meters, notes: [...codexExtras(codex, t), updated(codex.updatedAt, t)] } : null;
  },
};

function updated(time: number, t: TFunction<"shell">): string {
  return t("status.usageUpdated", { time: formatTime(time) });
}

/** Account figures retain their native unit, timestamp, missing data and explicit unlimited flag. */
export function presentUsage(usage: UsageView | null, info: VersionInfo | null, t: TFunction<"shell">) {
  const versions = providerVersions(info, t);
  const groups: UsageGroup[] = [];
  if (usage)
    for (const id of PROVIDER_IDS) {
      const group = adapters[id](usage, t);
      if (group) groups.push({ ...group, id, label: PROVIDER_LABELS[id], version: versions[id] });
    }
  return { groups, visible: groups.some((group) => group.meters.length > 0), warn: groups.some((group) => group.meters.some((meter) => meter.warn)) };
}

/** Codex's windows as it last reported them; a window it did not report is left out, not guessed. */
function codexMeters(codex: CodexUsage, t: TFunction<"shell">): UsageMeter[] {
  const meters: UsageMeter[] = [];
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

function claudeMeters(usage: UsageView, t: TFunction<"shell">): UsageMeter[] {
  const meters: UsageMeter[] = [];
  if (usage.fiveHour) meters.push(buildMeter(t, "5h", "5h", usage.fiveHour.usedPercentage, usage.fiveHour.resetsAt));
  if (usage.sevenDay) meters.push(buildMeter(t, "7d", "7d", usage.sevenDay.usedPercentage, usage.sevenDay.resetsAt));
  if (usage.spend) meters.push(buildMeter(t, "spend", "spend", usage.spend.usedPercentage, null));
  return meters;
}

function copilotUnit(quota: CopilotQuota, t: TFunction<"shell">): string {
  return t(quota.unit === "ai_credits" ? "status.copilotUnitAiCredits" : "status.copilotUnitPremiumRequests");
}

/** Copilot's account quota as its runtime last reported it. */
function copilotMeter(quota: CopilotQuota, t: TFunction<"shell">): UsageMeter {
  const unit = copilotUnit(quota, t);
  const extra = quota.used !== null && quota.entitlement !== null ? [t("status.copilotUsageUsed", { used: quota.used, entitlement: quota.entitlement, unit })] : [];
  const meter = buildMeter(t, "copilot", unit, quota.unlimited ? null : quota.usedPercentage, quota.resetsAt, extra);
  return quota.unlimited ? { ...meter, value: "∞" } : meter;
}

/** The one Meter every agent goes through: same reset line, and a figure whose window already reset is flagged as possibly stale. */
function buildMeter(t: TFunction<"shell">, id: string, label: string, percent: number | null, resetsAt: number | null | undefined, extra: string[] = []): UsageMeter {
  const notes = [...extra];
  if (resetsAt) {
    notes.push(t("status.usageReset", { window: label, time: formatTime(resetsAt) }));
    if (resetsAt < Date.now()) notes.push(t("status.usageStale"));
  }
  return { id, label, percent, notes, value: percent === null ? t("status.usageUnknown") : `${Math.round(percent)}%`, warn: percent !== null && percent >= 80 };
}

/** Same rule for every agent and window: time only when it is today, time plus weekday/date otherwise. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${time} ${d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" })}`;
}
