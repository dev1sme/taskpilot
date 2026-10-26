import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import i18n from "../../../i18n";
import { clearDraft, isDirty } from "./drafts";
import type { Scope } from "./types";

export const SCOPES: Scope[] = ["project", "local", "user"];

export const scopeLabel = (scope: Scope) => i18n.t(`scope.label.${scope}`, { ns: "config" });

export const scopeHint = (scope: Scope) => i18n.t(`scope.hint.${scope}`, { ns: "config" });

export function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <span className={`scope-tag scope-${scope}`} title={scopeHint(scope)}>
      {scopeLabel(scope)}
    </span>
  );
}

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
