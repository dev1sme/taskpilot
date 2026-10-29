import type { SessionObservation } from "@taskpilot/server/api-types";
import { useTranslation } from "react-i18next";
import { ObservationStatus } from "@/components/observation-status";

/** Absence of native evidence is explicit, even when the activity feed is empty. */
export function SessionObservationNote({ title, value }: { title: string; value: SessionObservation }) {
  const { t } = useTranslation("sessions");
  return (
    <details className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">
      <summary className="cursor-pointer py-2">
        {t("observation.title", { title })} · <ObservationStatus value={value.hooks} />
      </summary>
      <p className="max-w-prose pb-2">{t("observation.hint")}</p>
      <dl className="grid gap-1 pb-2">
        {(["childLifecycle", "compaction", "sessionEnd"] as const).map((key) => (
          <div key={key} className="flex flex-wrap gap-x-2">
            <dt>{t(`observation.${key}`)}</dt>
            <dd>
              <ObservationStatus value={value[key]} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
