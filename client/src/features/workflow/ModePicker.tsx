import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowApi } from "./api";
import { useWorkspace } from "../workspace";

interface Props {
  /** The mode chosen for this run; undefined follows the repo's. */
  value: string | undefined;
  onChange: (mode: string | undefined) => void;
  disabled?: boolean;
}

/** Which way to run the workflow: the repo's default, or any other mode, with no override needed. */
export function ModePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation("workflow");
  const { repo } = useWorkspace();
  const { data } = useQuery({ queryKey: ["workflow-modes", repo?.path], queryFn: () => workflowApi.modes(), enabled: !!repo?.path });
  if (!data) return null;
  const current = value ?? data.selected;
  const description = data.modes.find((m) => m.id === current)?.description;
  return (
    <label className="mode-picker" title={description}>
      <span>{t("mode.label")}</span>
      <select value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {!data.modes.some((mode) => mode.id === current) && (
          <option value={current} disabled>
            {current}
          </option>
        )}
        {data.modes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
