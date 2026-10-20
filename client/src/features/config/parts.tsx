import { ArrowClockwise, LockSimple, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
import i18n from "../../i18n";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Toolbar } from "../../shared/ui/Toolbar";
import { clearDraft, isDirty } from "./drafts";
import "./config.css";
import type { Scope } from "./types";

export const scopeLabel = (scope: Scope) => i18n.t(`scope.label.${scope}`, { ns: "config" });
export const scopeHint = (scope: Scope) => i18n.t(`scope.hint.${scope}`, { ns: "config" });

export function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <span className={`scope-tag scope-${scope}`} title={scopeHint(scope)}>
      {scopeLabel(scope)}
    </span>
  );
}

/** Header shared by the config pages: title and subtitle only; file actions go in `ConfigToolbar`. */
export function ConfigHeader(props: { title: ReactNode; subtitle?: ReactNode }) {
  return <PageHeader title={props.title} subtitle={props.subtitle} />;
}

/**
 * Toolbar of the config pages: what the page shows on the left (scope tabs…), reload and the actions
 * on what is shown on the right. `readOnly` pages get a marker in place of actions.
 */
export function ConfigToolbar(props: {
  start?: ReactNode;
  actions?: ReactNode;
  readOnly?: boolean;
  loading: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation("config");
  return (
    <Toolbar
      className="config-toolbar"
      start={props.start}
      actions={
        <>
          <Button icon={ArrowClockwise} variant="quiet" className="btn-icon-only" title={t("toolbar.reload")} busy={props.loading} onClick={props.onReload}>
            <span className="sr-only">{t("toolbar.reload")}</span>
          </Button>
          {props.readOnly && (
            <span className="readonly-pill" title={t("toolbar.readOnlyTitle")}>
              <LockSimple weight="bold" aria-hidden="true" />
              {t("toolbar.readOnly")}
            </span>
          )}
          {props.actions}
        </>
      }
    />
  );
}

export const SCOPES: Scope[] = ["project", "local", "user"];

/** One tab per scope (all three unless `scopes` says otherwise); a dot marks a scope with unsaved edits. */
export function ScopeTabs<S extends Scope>(props: {
  value: S;
  onChange: (scope: S) => void;
  label: string;
  labels: Record<S, string>;
  scopes?: readonly S[];
  /** Number shown after the label, e.g. how many items the scope holds. */
  count?: (scope: S) => number;
  isMissing?: (scope: S) => boolean;
  isDirty?: (scope: S) => boolean;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="segmented scope-tabs" role="tablist" aria-label={props.label}>
      {(props.scopes ?? (SCOPES as S[])).map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={s === props.value}
          title={scopeHint(s)}
          aria-label={props.count && `${props.labels[s]} (${props.count(s)})`}
          onClick={() => props.onChange(s)}
          className={props.isMissing?.(s) ? "is-missing" : undefined}
        >
          {props.labels[s]}
          {props.count && <span className="tab-count">{props.count(s)}</span>}
          {props.isDirty?.(s) && <span className="tab-dirty" aria-label={t("unsaved")} />}
        </button>
      ))}
    </div>
  );
}

/**
 * "● Chưa lưu" marker and the cancel button of an open draft. Cancelling asks again only when the
 * draft has unsaved changes.
 */
export function DraftControls({ draftKey }: { draftKey: string }) {
  const { t } = useTranslation("config");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = isDirty(draftKey);
  const discard = () => {
    clearDraft(draftKey);
    setConfirmDiscard(false);
  };

  return (
    <>
      {dirty && (
        <span className="unsaved-pill">
          <span aria-hidden="true" />
          {t("draft.unsaved")}
        </span>
      )}
      {dirty && confirmDiscard ? (
        <Button icon={X} variant="danger" onClick={discard}>
          {t("draft.discard")}
        </Button>
      ) : (
        <Button icon={X} variant="quiet" onClick={() => (dirty ? setConfirmDiscard(true) : discard())}>
          {t("draft.cancel")}
        </Button>
      )}
    </>
  );
}

export function LoadError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error config-error" role="alert">
      {error}
    </p>
  );
}

/** "Bash(npm test)" → tool "Bash", argument "npm test". */
export function RuleChip({ rule }: { rule: string }) {
  const m = /^([^(]+)\((.*)\)$/.exec(rule);
  return (
    <span className="rule-chip">
      <span className="rule-tool">{m ? m[1] : rule}</span>
      {m && <span className="rule-arg">{m[2]}</span>}
    </span>
  );
}

export function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-card">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
