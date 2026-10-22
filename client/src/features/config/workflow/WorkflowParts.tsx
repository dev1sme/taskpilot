import { useTranslation } from "react-i18next";
import type { WorkflowConfig } from "./types";

/** What an override is, what each file changes, when changes apply and how to go back. */
export function OverrideGuide({ dir, open }: { dir: string; open: boolean }) {
  const { t } = useTranslation("config");
  const files = ["yml", "prompt", "onReject", "format"] as const;
  const points = ["when", "tasks", "updates", "back", "share"] as const;
  return (
    <details className="card wf-guide" open={open}>
      <summary className="card-title">{t("workflow.guide.title")}</summary>
      <p>{t("workflow.guide.intro", { dir })}</p>
      <table className="wf-guide-files">
        <thead>
          <tr>
            <th scope="col">{t("workflow.guide.fileHead")}</th>
            <th scope="col">{t("workflow.guide.effectHead")}</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f}>
              <td className="mono">{t(`workflow.guide.file.${f}.name`)}</td>
              <td>{t(`workflow.guide.file.${f}.effect`, { v: "{{key}}" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="wf-guide-points">
        {points.map((p) => (
          <li key={p}>
            <strong>{t(`workflow.guide.point.${p}.title`)}</strong> {t(`workflow.guide.point.${p}.body`, { dir })}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function OriginBadge({ config }: { config: WorkflowConfig }) {
  const { t } = useTranslation("config");
  return (
    <span className={`wf-origin wf-origin-${config.origin}`} title={config.dir}>
      {config.origin === "repo" ? t("workflow.originRepo", { name: config.mode.name, dir: config.overrideDir }) : t("workflow.originDefault", { name: config.mode.name })}
    </span>
  );
}

/** The ways the repo can run a workflow: pick one to look at it; the repo's own is marked. */
export function ModeBar({ config, onPick }: { config: WorkflowConfig; onPick: (id: string) => void }) {
  const { t } = useTranslation("config");
  return (
    <section className="card wf-modes" aria-label={t("workflow.modes.label")}>
      <h2 className="card-title">{t("workflow.modes.label")}</h2>
      <p className="field-help">{t("workflow.modes.help")}</p>
      <div className="segmented" role="tablist" aria-label={t("workflow.modes.tabs")}>
        {config.modes.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={m.id === config.mode.id} title={m.description} onClick={() => onPick(m.id)}>
            {m.name}
            {m.id === config.selected && <span className="wf-tag"> · {t("workflow.modes.repoDefault")}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
