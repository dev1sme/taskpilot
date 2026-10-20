import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isSeq, parseDocument, type Document } from "yaml";
import { Button } from "../../../shared/ui/Button";

const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"];

interface StepModel {
  id?: string;
  title?: string;
  prompt?: string;
  "on-reject"?: string;
  gate?: string;
  "done-when"?: string;
  outputs?: Array<{ id?: string; file?: string; content?: string; format?: string }>;
}

interface Model {
  "permission-mode"?: string;
  history?: { file?: string; entry?: string; format?: string };
  language?: string;
  rules?: string[];
  restart?: { read?: string[] };
  steps?: StepModel[];
}

type Path = Array<string | number>;

/**
 * workflow.yml as a form. The YAML text stays the draft: every change edits the parsed document in
 * place (comments and key order kept) and hands back its text, so the YAML tab always matches.
 */
export function WorkflowForm(props: { text: string; prompts: string[]; onChange: (text: string) => void }) {
  const { t } = useTranslation("config");
  const doc = parseDocument(props.text);
  if (doc.errors.length > 0) {
    return (
      <p className="error" role="alert">
        {t("workflow.form.yamlError", { error: doc.errors[0].message })}
      </p>
    );
  }
  const model = (doc.toJS() ?? {}) as Model;
  const steps = model.steps ?? [];
  const outputIds = steps.flatMap((s) => (s.outputs ?? []).map((o) => o.id ?? "")).filter(Boolean);

  const edit = (fn: (d: Document) => void) => {
    const next = parseDocument(props.text);
    fn(next);
    props.onChange(next.toString());
  };
  /** Sets a value; an empty optional value removes the key. */
  const set = (path: Path, value: string, optional = false) =>
    edit((d) => (optional && value === "" ? d.deleteIn(path) : d.setIn(path, value)));
  const add = (path: Path, value: unknown) =>
    edit((d) => {
      if (!isSeq(d.getIn(path))) d.setIn(path, d.createNode([]));
      d.addIn(path, d.createNode(value));
    });
  const remove = (path: Path) => edit((d) => d.deleteIn(path));
  const move = (path: Path, from: number, to: number) =>
    edit((d) => {
      const seq = d.getIn(path);
      if (!isSeq(seq) || to < 0 || to >= seq.items.length) return;
      [seq.items[from], seq.items[to]] = [seq.items[to], seq.items[from]];
    });

  return (
    <div className="wf-form">
      <section className="card wf-section">
        <h3 className="card-title">{t("workflow.form.general")}</h3>
        <div className="form-grid">
          <Field label={t("workflow.form.permissionMode")} help={t("workflow.form.permissionModeHelp")}>
            {(id) => (
              <select id={id} value={model["permission-mode"] ?? ""} onChange={(e) => set(["permission-mode"], e.target.value, true)}>
                <option value="">{t("workflow.form.permissionDefault")}</option>
                {PERMISSION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("workflow.form.historyFile")} help={t("workflow.form.historyFileHelp")}>
            {(id) => <input id={id} className="mono" value={model.history?.file ?? ""} placeholder="00-history.md" onChange={(e) => set(["history", "file"], e.target.value, true)} />}
          </Field>
          <Field label={t("workflow.form.historyEntry")} help={t("workflow.form.historyEntryHelp", { v: "{{historyEntry}}" })}>
            {(id) => <input id={id} className="mono" value={model.history?.entry ?? ""} onChange={(e) => set(["history", "entry"], e.target.value, true)} />}
          </Field>
          <Field label={t("workflow.form.historyFormat")} help={t("workflow.form.historyFormatHelp", { v: "{{historyFormat}}" })}>
            {(id) => <FileSelect id={id} value={model.history?.format ?? ""} files={props.prompts} onChange={(v) => set(["history", "format"], v, true)} />}
          </Field>
          <Field label={t("workflow.form.language")} help={t("workflow.form.languageHelp", { v: "{{language}}" })}>
            {(id) => <input id={id} value={model.language ?? ""} onChange={(e) => set(["language"], e.target.value, true)} />}
          </Field>
        </div>

        <div className="pane-label">{t("workflow.form.rules")}</div>
        <p className="field-help">{t("workflow.form.rulesHelp", { v: "{{rules}}" })}</p>
        <ul className="wf-rows">
          {(model.rules ?? []).map((rule, i) => (
            <li key={i} className="wf-row">
              <input aria-label={t("workflow.form.rule", { n: i + 1 })} value={rule} onChange={(e) => set(["rules", i], e.target.value)} />
              <IconAction icon={Trash} label={t("workflow.form.removeRule")} onClick={() => remove(["rules", i])} />
            </li>
          ))}
        </ul>
        <Button icon={Plus} variant="quiet" onClick={() => add(["rules"], "")}>
          {t("workflow.form.addRule")}
        </Button>

        <div className="pane-label">{t("workflow.form.restartRead")}</div>
        <p className="field-help">{t("workflow.form.restartReadHelp", { v: "{{previousRun}}" })}</p>
        <div className="wf-checks">
          {outputIds.map((id) => {
            const read = model.restart?.read ?? [];
            const on = read.includes(id);
            return (
              <label key={id} className="wf-check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => edit((d) => d.setIn(["restart", "read"], d.createNode(on ? read.filter((r) => r !== id) : [...read, id], { flow: true })))}
                />
                <span className="mono">{id}</span>
              </label>
            );
          })}
        </div>
      </section>

      {steps.map((step, i) => (
        <section key={i} className="card wf-section" aria-label={t("workflow.form.stepLabel", { n: i + 1, title: step.title ?? step.id })}>
          <header className="wf-step-head">
            <h3 className="card-title">
              {t("workflow.form.step", { n: i + 1 })} · {step.title ?? step.id}
            </h3>
            <div className="wf-step-actions">
              <IconAction icon={ArrowUp} label={t("workflow.form.moveUp")} disabled={i === 0} onClick={() => move(["steps"], i, i - 1)} />
              <IconAction icon={ArrowDown} label={t("workflow.form.moveDown")} disabled={i === steps.length - 1} onClick={() => move(["steps"], i, i + 1)} />
              <IconAction icon={Trash} label={t("workflow.form.removeStep")} disabled={steps.length === 1} onClick={() => remove(["steps", i])} />
            </div>
          </header>
          <div className="form-grid">
            <Field label={t("workflow.form.title")}>{(id) => <input id={id} value={step.title ?? ""} onChange={(e) => set(["steps", i, "title"], e.target.value, true)} />}</Field>
            <Field label={t("workflow.form.id")} help={t("workflow.form.idHelp")}>
              {(id) => <input id={id} className="mono" value={step.id ?? ""} onChange={(e) => set(["steps", i, "id"], e.target.value)} />}
            </Field>
            <Field label={t("workflow.form.prompt")}>
              {(id) => (
                <select id={id} value={step.prompt ?? ""} onChange={(e) => set(["steps", i, "prompt"], e.target.value)}>
                  {!props.prompts.includes(step.prompt ?? "") && <option value={step.prompt ?? ""}>{step.prompt || "—"}</option>}
                  {props.prompts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("workflow.form.onReject")} help={t("workflow.form.onRejectHelp")}>
              {(id) => (
                <select id={id} value={step["on-reject"] ?? ""} onChange={(e) => set(["steps", i, "on-reject"], e.target.value, true)}>
                  <option value="">{t("workflow.form.none")}</option>
                  {props.prompts.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("workflow.form.gate")}>
              {(id) => (
                <select id={id} value={step.gate ?? "none"} onChange={(e) => set(["steps", i, "gate"], e.target.value)}>
                  <option value="approve">{t("workflow.gate.approve")}</option>
                  <option value="none">{t("workflow.gate.none")}</option>
                </select>
              )}
            </Field>
            <Field label={t("workflow.form.doneWhen")} help={t("workflow.form.doneWhenHelp")}>
              {(id) => (
                <select id={id} value={step["done-when"] ?? ""} onChange={(e) => set(["steps", i, "done-when"], e.target.value, true)}>
                  <option value="">{t("workflow.form.none")}</option>
                  {(step.outputs ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} ({o.file})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="pane-label">{t("workflow.form.outputs")}</div>
          <p className="field-help">{t("workflow.form.outputsHelp", { v: "{{outputs}}", w: "{{out.<id>}}" })}</p>
          <ul className="wf-rows">
            {(step.outputs ?? []).map((o, j) => (
              <li key={j} className="wf-row wf-output">
                <input className="mono" aria-label={t("workflow.form.outputId")} placeholder="plan" value={o.id ?? ""} onChange={(e) => set(["steps", i, "outputs", j, "id"], e.target.value)} />
                <input className="mono" aria-label={t("workflow.form.outputFile")} placeholder="02-plan.md" value={o.file ?? ""} onChange={(e) => set(["steps", i, "outputs", j, "file"], e.target.value)} />
                <input aria-label={t("workflow.form.outputContent")} placeholder={t("workflow.form.outputContentPlaceholder")} value={o.content ?? ""} onChange={(e) => set(["steps", i, "outputs", j, "content"], e.target.value, true)} />
                <FileSelect label={t("workflow.form.outputFormat")} value={o.format ?? ""} files={props.prompts} onChange={(v) => set(["steps", i, "outputs", j, "format"], v, true)} />
                <IconAction icon={Trash} label={t("workflow.form.removeOutput")} onClick={() => remove(["steps", i, "outputs", j])} />
              </li>
            ))}
          </ul>
          <Button icon={Plus} variant="quiet" onClick={() => add(["steps", i, "outputs"], { id: "", file: "", content: "" })}>
            {t("workflow.form.addOutput")}
          </Button>
        </section>
      ))}

      <Button icon={Plus} onClick={() => add(["steps"], { id: `step-${steps.length + 1}`, title: t("workflow.form.newStep"), prompt: props.prompts[0] ?? "", gate: "approve", outputs: [] })}>
        {t("workflow.form.addStep")}
      </Button>
    </div>
  );
}

function Field(props: { label: string; help?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{props.label}</label>
      <div className="wf-field">
        {props.children(id)}
        {props.help && <span className="field-help">{props.help}</span>}
      </div>
    </>
  );
}

/** A file of the workflow directory, or none. */
function FileSelect(props: { id?: string; label?: string; value: string; files: string[]; onChange: (value: string) => void }) {
  const { t } = useTranslation("config");
  return (
    <select id={props.id} aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{t("workflow.form.none")}</option>
      {!props.files.includes(props.value) && props.value && <option value={props.value}>{props.value}</option>}
      {props.files.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}

function IconAction(props: { icon: typeof Trash; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button icon={props.icon} variant="quiet" className="btn-icon-only" title={props.label} disabled={props.disabled} onClick={props.onClick}>
      <span className="sr-only">{props.label}</span>
    </Button>
  );
}
