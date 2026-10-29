import { Info } from "@phosphor-icons/react";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@taskpilot/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useServerInfo } from "@/features/workspace/queries";

/** CLI versions are available on demand from every page, including mobile. */
export function CliInfo() {
  const { t } = useTranslation(["shell", "common"]);
  const info = useServerInfo();
  const headingId = useId();
  return (
    <Popover>
      <PopoverTrigger aria-label={t("cliInfo.title")} className="flex min-h-6 items-center gap-1.5 rounded-sm px-1.5 hover:bg-hover hover:text-ink">
        <Info aria-hidden />
        {t("cliInfo.button")}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" aria-labelledby={headingId}>
        <h2 id={headingId} className="text-sm font-semibold">
          {t("cliInfo.title")}
        </h2>
        <p className="mt-1 text-xs text-muted">{t("cliInfo.hint")}</p>
        {info.error ? (
          <p role="alert" className="mt-3 break-words text-sm text-danger">
            {info.error.message}
          </p>
        ) : !info.data ? (
          <p className="mt-3 text-sm text-muted">{t("common:loading")}</p>
        ) : (
          <dl className="mt-3 divide-y divide-line text-sm">
            {PROVIDER_IDS.map((id) => (
              <div key={id} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-4 py-2">
                <dt className="font-medium">{PROVIDER_LABELS[id]}</dt>
                <dd className="min-w-0 break-all text-right font-mono text-xs text-muted">{info.data.versions[id] ?? t("cliInfo.missing")}</dd>
              </div>
            ))}
          </dl>
        )}
      </PopoverContent>
    </Popover>
  );
}
