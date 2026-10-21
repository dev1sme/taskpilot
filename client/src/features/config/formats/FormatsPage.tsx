import { PencilSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { href, navigate } from "../../../shared/router";
import { Button } from "../../../shared/ui/Button";
import { Markdown } from "../../../shared/ui/Markdown";
import { ConfigHeader, ConfigToolbar, LoadError } from "../shared/parts";
import { useConfig } from "../shared/useConfig";
import { workflowConfigApi } from "../workflow/api";
import type { WorkflowConfig } from "../workflow/types";
import "../shared/code-view.css";
import "./formats.css";

/**
 * The documents a workflow makes Claude write, step by step, each with its skeleton (format file):
 * what a task's documents will look like. Skeletons are edited on the Workflow page.
 */
export function FormatsPage() {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["workflow"], () => workflowConfigApi.get());
  const steps = data?.def?.steps ?? [];
  const history = data?.def?.history;

  return (
    <div className="page">
      <ConfigHeader title={t("formats.title")} subtitle={t("formats.subtitle")} />
      <ConfigToolbar readOnly loading={loading} onReload={() => void reload()} />
      <LoadError error={error} />
      {data && (
        <div className="page-body fmt-page">
          <p className="hint">
            <Trans
              t={t}
              i18nKey={data.origin === "repo" ? "formats.editHintRepo" : "formats.editHintDefault"}
              values={{ dir: data.overrideDir }}
              components={{ link: <a href={href({ page: "config", section: "workflow" })} /> }}
            />
          </p>
          {data.errors.length > 0 && <p className="alert-warn">{t("formats.invalid")}</p>}
          {steps.map((s, i) => (
            <section key={s.id} className="fmt-step" aria-label={t("workflow.form.stepLabel", { n: i + 1, title: s.title })}>
              <h2 className="pane-label">{t("workflow.form.stepLabel", { n: i + 1, title: s.title })}</h2>
              {s.outputs.length === 0 && <p className="hint">{t("formats.noOutputs")}</p>}
              {s.outputs.map((o) => (
                <FormatCard
                  key={o.id}
                  config={data}
                  file={o.file}
                  description={o.content}
                  format={o.format}
                  done={o.id === s.doneWhen}
                />
              ))}
            </section>
          ))}
          {history && (
            <section className="fmt-step" aria-label={t("formats.historyTitle")}>
              <h2 className="pane-label">{t("formats.historyTitle")}</h2>
              <FormatCard config={data} file={history.file} description={t("formats.historyBody")} format={history.format} done={false} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function FormatCard(props: { config: WorkflowConfig; file: string; description: string; format: string | null; done: boolean }) {
  const { t } = useTranslation("config");
  const [raw, setRaw] = useState(false);
  const skeletonText = props.format ? props.config.resolved[props.format] : undefined;
  const inOverride = !!props.format && props.config.files.some((f) => f.name === props.format);

  return (
    <article className="card fmt-card">
      <header className="fmt-head">
        <div>
          <h3 className="mono">{props.file}</h3>
          {props.description && <p className="field-help">{props.description}</p>}
          <p className="fmt-meta">
            {props.format ? t("formats.skeleton", { file: props.format }) : t("formats.noSkeleton")}
            {props.done && <> · {t("formats.doneWhen")}</>}
          </p>
        </div>
        {skeletonText !== undefined && (
          <div className="fmt-actions">
            <div className="segmented" role="tablist" aria-label={t("formats.view")}>
              <button type="button" role="tab" aria-selected={!raw} onClick={() => setRaw(false)}>
                {t("formats.rendered")}
              </button>
              <button type="button" role="tab" aria-selected={raw} onClick={() => setRaw(true)}>
                {t("formats.raw")}
              </button>
            </div>
            {props.config.origin === "repo" && inOverride && (
              <Button icon={PencilSimple} variant="quiet" onClick={() => navigate({ page: "config", section: "workflow", file: props.format! })}>
                {t("action.edit")}
              </Button>
            )}
          </div>
        )}
      </header>
      {skeletonText !== undefined &&
        (raw ? (
          <pre className="fmt-raw">{skeletonText}</pre>
        ) : (
          <div className="fmt-rendered">
            <Markdown source={showHints(skeletonText)} />
          </div>
        ))}
    </article>
  );
}

/** `<!-- hint -->` lines would vanish once rendered; show them as quoted notes instead. */
function showHints(text: string): string {
  return text.replace(/<!--\s*([\s\S]*?)\s*-->/g, (_, hint: string) => `> ${hint.replace(/\n/g, " ")}`);
}
