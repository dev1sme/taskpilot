import type { UsageView, UsageWindow } from "@taskpilot/server/api-types";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { Gauge } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROVIDER_LABELS } from "@taskpilot/shared";
import { locale } from "@/i18n";
import { clockTime, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { peakUsage, useUsage } from "./queries";

/** Above this share a meter turns attention-colored; the number stays the primary signal. */
const HIGH = 80;

/** The status bar's usage counter and its popover with every agent's windows. */
export function UsageButton() {
  const { t } = useTranslation("shell");
  const usage = useUsage().data;
  const now = useNow(60_000);
  const peak = peakUsage(usage, now);
  const reduceMotion = useReducedMotion();
  return (
    <MotionConfig reducedMotion="user">
      <Popover>
        <PopoverTrigger
          title={t("usage.buttonTitle")}
          className={cn("flex min-h-6 items-center gap-1.5 rounded-sm px-1.5 hover:bg-hover hover:text-ink", peak !== null && peak >= HIGH && "font-medium text-attention")}
        >
          <Gauge weight="bold" aria-hidden />
          {t("usage.button")}
          {peak !== null && <span className="tabular-nums">{t("usage.percent", { value: Math.round(peak) })}</span>}
        </PopoverTrigger>
        <PopoverContent side="top" align="end" asChild>
          <motion.div
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6, scale: reduceMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <UsagePanel usage={usage} />
          </motion.div>
        </PopoverContent>
      </Popover>
    </MotionConfig>
  );
}

/** Every agent's account usage; also the overview's usage card. */
export function UsagePanel({ usage, heading = true, className }: { usage: UsageView | null | undefined; heading?: boolean; className?: string }) {
  const { t } = useTranslation("shell");
  const copilot = usage?.agents?.copilot;
  const codex = usage?.agents?.codex;
  const claude = usage && (usage.fiveHour || usage.sevenDay || usage.spend) ? usage : null;
  return (
    <div className={cn("grid gap-3 text-sm", className)}>
      {heading && <p className="font-medium">{t("usage.title")}</p>}
      {!claude && !copilot && !codex && <p className="text-muted">{t("usage.none")}</p>}
      {claude && (
        <Agent name={PROVIDER_LABELS.claude} updatedAt={claude.updatedAt}>
          {claude.fiveHour && <Meter label={t("usage.fiveHour")} window={claude.fiveHour} />}
          {claude.sevenDay && <Meter label={t("usage.sevenDay")} window={claude.sevenDay} />}
          {claude.spend && <Meter label={t("usage.spend")} window={{ usedPercentage: claude.spend.usedPercentage, resetsAt: null }} />}
        </Agent>
      )}
      {copilot && (
        <Agent name={PROVIDER_LABELS.copilot} updatedAt={copilot.updatedAt}>
          {copilot.unlimited || copilot.usedPercentage === null ? (
            <p className="text-xs text-muted">{t("usage.unlimited")}</p>
          ) : (
            <Meter
              label={t("usage.quota")}
              window={{ usedPercentage: copilot.usedPercentage, resetsAt: copilot.resetsAt }}
              detail={
                copilot.used !== null && copilot.entitlement !== null
                  ? t("usage.used", { used: copilot.used.toLocaleString(locale()), total: copilot.entitlement.toLocaleString(locale()), unit: t(`usage.unit.${copilot.unit}`) })
                  : undefined
              }
            />
          )}
        </Agent>
      )}
      {codex && (
        <Agent name={PROVIDER_LABELS.codex} updatedAt={codex.updatedAt} note={codex.planType ? t("usage.plan", { plan: codex.planType }) : undefined}>
          {codex.fiveHour && <Meter label={t("usage.fiveHour")} window={codex.fiveHour} />}
          {codex.sevenDay && <Meter label={t("usage.sevenDay")} window={codex.sevenDay} />}
          {codex.credits?.hasCredits && (
            <p className="text-xs text-muted">{codex.credits.unlimited ? t("usage.creditsUnlimited") : t("usage.credits", { balance: codex.credits.balance ?? "?" })}</p>
          )}
          {codex.rateLimitReachedType && (
            <p role="status" className="text-xs font-medium text-attention">
              {t("usage.limitReached", { type: codex.rateLimitReachedType })}
            </p>
          )}
        </Agent>
      )}
    </div>
  );
}

function Agent({ name, updatedAt, note, children }: { name: string; updatedAt?: number; note?: string; children: React.ReactNode }) {
  const { t } = useTranslation("shell");
  return (
    <section className="grid gap-2 border-t border-line pt-2.5">
      <p className="flex items-baseline gap-2">
        <span className="font-medium">{name}</span>
        {note && <span className="text-xs text-muted">{note}</span>}
        {updatedAt !== undefined && <span className="ml-auto text-xs text-faint">{t("usage.updated", { time: clockTime(updatedAt) })}</span>}
      </p>
      {children}
    </section>
  );
}

/** A usage window: label, the share as text, a bar, and when it resets. */
function Meter({ label, window, detail }: { label: string; window: UsageWindow; detail?: string }) {
  const { t } = useTranslation("shell");
  const now = useNow(60_000);
  const reset = window.resetsAt !== null && window.resetsAt <= now;
  const value = reset ? 0 : Math.min(100, Math.max(0, window.usedPercentage));
  const high = value >= HIGH;
  const reduceMotion = useReducedMotion();
  return (
    <div className="grid gap-1">
      <p className="flex items-baseline gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className={cn("ml-auto font-mono tabular-nums", high && "font-semibold text-attention")}>
          {t("usage.percent", { value: Math.round(value) })}
          {value >= 100 && ` · ${t("usage.exhausted")}`}
        </span>
      </p>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <motion.div
          className={cn("h-full origin-left rounded-full", high ? "bg-attention" : "bg-signal")}
          initial={{ scaleX: reduceMotion ? value / 100 : 0 }}
          animate={{ scaleX: value / 100 }}
          transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      {(detail || (window.resetsAt !== null && !reset)) && (
        <p className="flex gap-2 text-xs text-faint">
          {detail && <span>{detail}</span>}
          {window.resetsAt !== null && !reset && <span className="ml-auto">{t("usage.resets", { time: clockTime(window.resetsAt) })}</span>}
        </p>
      )}
    </div>
  );
}
