import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowApi } from "./api";

interface Props {
  /** The mode chosen for this run; undefined follows the repo's. */
  value: string | undefined;
  onChange: (mode: string | undefined) => void;
  disabled?: boolean;
}

/** Which way to run the workflow: the repo's default, or any other mode, with no override needed. */
export function ModePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation("workflow");
  const { data } = useQuery({ queryKey: ["workflow-modes"], queryFn: () => workflowApi.modes() });
  if (!data || data.modes.length < 2) return null;
  const current = value ?? data.selected;
  const description = data.modes.find((m) => m.id === current)?.description;
  return (
    <label className="mode-picker" title={description}>
      <span>{t("mode.label")}</span>
      <select value={current} disabled={disabled} onChange={(e) => onChange(e.target.value === data.selected ? undefined : e.target.value)}>
        {data.modes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
