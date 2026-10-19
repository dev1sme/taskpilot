import { ArrowClockwise, LockSimple } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { Scope } from "../../api/types";
import { Button } from "../../components/Button";
import { PageHeader } from "../shell/PageHeader";
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
  extra?: ReactNode;
  /** Edit actions; without them the page is marked read-only. */
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={props.title}
      subtitle={props.subtitle}
      actions={
        <>
          {props.extra}
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

/** "● Chưa lưu" marker shown while a draft exists. */
export function UnsavedPill() {
  return (
    <span className="unsaved-pill">
      <span aria-hidden="true" />
      Chưa lưu
    </span>
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
