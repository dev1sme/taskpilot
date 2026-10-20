import { ArrowClockwise, LockSimple, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { PageHeader } from "../shell/PageHeader";
import { clearDraft, isDirty } from "./drafts";
import "./config.css";

export const SCOPE_LABEL: Record<Scope, string> = {
  project: "Project",
  local: "Local",
  user: "User",
};

export const SCOPE_HINT: Record<Scope, string> = {
  project: "Commit vào repo, cả team dùng chung",
  local: "Chỉ trên máy ba, không commit",
  user: "Mọi repo trên máy ba",
};

export function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <span className={`scope-tag scope-${scope}`} title={SCOPE_HINT[scope]}>
      {SCOPE_LABEL[scope]}
    </span>
  );
}

/** Header shared by the config pages: page actions (or a read-only marker) and a reload button. */
export function ConfigHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  loading: boolean;
  onReload: () => void;
  /** Edit actions; without them the page is marked read-only. */
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={props.title}
      subtitle={props.subtitle}
      actions={
        <>
          {props.actions ?? (
            <span className="readonly-pill" title="Trang này chưa sửa được trong TaskPilot">
              <LockSimple weight="bold" aria-hidden="true" />
              Chỉ xem
            </span>
          )}
          <Button icon={ArrowClockwise} variant="quiet" busy={props.loading} onClick={props.onReload}>
            Tải lại
          </Button>
        </>
      }
    />
  );
}

/**
 * "● Chưa lưu" marker and the cancel button of an open draft. Cancelling asks again only when the
 * draft has unsaved changes.
 */
export function DraftControls({ draftKey }: { draftKey: string }) {
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
          Chưa lưu
        </span>
      )}
      {dirty && confirmDiscard ? (
        <Button icon={X} variant="danger" onClick={discard}>
          Bỏ thay đổi
        </Button>
      ) : (
        <Button icon={X} variant="quiet" onClick={() => (dirty ? setConfirmDiscard(true) : discard())}>
          Huỷ
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
