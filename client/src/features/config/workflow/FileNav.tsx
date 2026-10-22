import { Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { href } from "../../../shared/router";
import { Button } from "../../../shared/ui/Button";
import { isDirty } from "../shared/drafts";
import type { WorkflowConfig } from "./types";
import { draftKey, formatUse, PROMPT_FILE, WORKFLOW_FILE } from "./workflow-files";

export function FileNav(props: { config: WorkflowConfig; picked: string; newFiles: string[]; adding: boolean; onPick: (name: string) => void; onAdd: (name: string) => void }) {
  const { t } = useTranslation("config");
  const { config } = props;
  const steps = config.def?.steps ?? [];
  // Skeletons get their own group (and their own page, Định dạng tài liệu), apart from the steps' prompts.
  const formats = [...new Set([config.def?.history.format ?? "", ...steps.flatMap((s) => s.outputs.map((o) => o.format ?? ""))].filter(Boolean))];
  const known = new Set([WORKFLOW_FILE, ...formats, ...steps.flatMap((s) => [s.promptFile, s.onRejectFile ?? ""])]);
  const loose = [...config.files.map((f) => f.name).filter((n) => !known.has(n)), ...props.newFiles];

  const item = (name: string, label?: string) => {
    const file = config.files.find((f) => f.name === name);
    const mine = config.provenance !== null;
    // An `extends` override only holds its own files: the mode's other ones are not the repo's to open.
    if (mine && !file && !isDirty(draftKey(name))) {
      return (
        <li key={`${label ?? ""}${name}`}>
          <span className="lib-item wf-item">
            <span className="lib-name mono" title={name}>
              {name}
            </span>
            <span className="wf-tag">{t("workflow.tag.builtin")}</span>
            {label && <span className="lib-desc">{label}</span>}
          </span>
        </li>
      );
    }
    return (
      <li key={`${label ?? ""}${name}`}>
        <button type="button" className="lib-item wf-item" aria-current={props.picked === name} onClick={() => props.onPick(name)}>
          <span className="lib-name mono" title={name}>
            {name}
          </span>
          {isDirty(draftKey(name)) ? (
            <span className="unsaved-pill">{t("draft.unsaved")}</span>
          ) : file?.provenance ? (
            <span className={`wf-tag${file.provenance === "builtin" ? "" : " is-changed"}`}>{t(`workflow.tag.${file.provenance}`)}</span>
          ) : (
            config.origin === "repo" &&
            file?.sameAsDefault !== undefined && (
              <span className={`wf-tag${file.sameAsDefault ? "" : " is-changed"}`}>
                {file.sameAsDefault === null ? t("workflow.tag.new") : file.sameAsDefault ? t("workflow.tag.same") : t("workflow.tag.changed")}
              </span>
            )
          )}
          {label && <span className="lib-desc">{label}</span>}
        </button>
      </li>
    );
  };

  return (
    <nav className="library-list wf-nav" aria-label={t("workflow.files")}>
      <ul>{item(WORKFLOW_FILE, t("workflow.ymlLabel"))}</ul>
      {steps.map((s, i) => (
        <div key={s.id} className="wf-nav-step">
          <div className="pane-label">
            {t("workflow.form.step", { n: i + 1 })} · {s.title}
          </div>
          <p className="wf-step-meta">
            {t(`workflow.gate.${s.gate}`)}
            {s.outputs.length > 0 && <> · {s.outputs.map((o) => (o.id === s.doneWhen ? `${o.file} ✓` : o.file)).join(", ")}</>}
            {(() => {
              const p = config.provenance?.steps.find((x) => x.id === s.id);
              return p && <> · {t(`workflow.step.${p.status}`, { keys: p.keys.join(", ") })}</>;
            })()}
          </p>
          <ul>
            {item(s.promptFile, t("workflow.promptLabel"))}
            {s.onRejectFile && item(s.onRejectFile, t("workflow.onRejectLabel"))}
          </ul>
        </div>
      ))}
      {formats.length > 0 && (
        <div className="wf-nav-step">
          <div className="pane-label">{t("workflow.formatsGroup")}</div>
          <p className="wf-step-meta">
            <a href={href({ page: "config", section: "formats" })}>{t("workflow.formatsLink")}</a>
          </p>
          <ul>{formats.map((n) => item(n, formatUse(config, n)))}</ul>
        </div>
      )}
      {loose.length > 0 && (
        <div className="wf-nav-step">
          <div className="pane-label">{t("workflow.otherFiles")}</div>
          <ul>{loose.map((n) => item(n))}</ul>
        </div>
      )}
      {props.adding && <NewPromptForm existing={[...config.files.map((f) => f.name), ...props.newFiles]} onAdd={props.onAdd} />}
    </nav>
  );
}

function NewPromptForm({ existing, onAdd }: { existing: string[]; onAdd: (name: string) => void }) {
  const { t } = useTranslation("config");
  const [name, setName] = useState("");
  const file = name.endsWith(".md") ? name : `${name}.md`;
  const error = !name ? null : !PROMPT_FILE.test(file) ? t("workflow.promptNameHelp") : existing.includes(file) ? t("library.exists", { path: file }) : null;
  return (
    <form
      className="wf-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (name && !error) onAdd(file);
      }}
    >
      <label className="pane-label" htmlFor="wf-new-name">
        {t("workflow.addPrompt")}
      </label>
      <div className="wf-row">
        <input id="wf-new-name" className="mono" value={name} placeholder="review.md" autoFocus spellCheck={false} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={Plus} disabled={!name || !!error}>
          {t("action.add")}
        </Button>
      </div>
      <span className={error ? "error" : "field-help"}>{error ?? t("workflow.promptNameHelp")}</span>
    </form>
  );
}
