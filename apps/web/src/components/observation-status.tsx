import type { ObservationAvailability } from "@taskpilot/server/api-types";
import { useTranslation } from "react-i18next";

export function ObservationStatus({ value }: { value: ObservationAvailability }) {
  const { t } = useTranslation("common");
  return (
    <span>
      {t(`observation.states.${value.state}`)}
      {value.reason && <> · {t(`observation.reasons.${value.reason}`)}</>}
    </span>
  );
}
