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

/** Header shared by the config pages: read-only marker and a reload button. */
export function ConfigHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  loading: boolean;
  onReload: () => void;
  extra?: ReactNode;
}) {
  return (
    <PageHeader
      title={props.title}
      subtitle={props.subtitle}
      actions={
        <>
          {props.extra}
          <span className="readonly-pill" title="Sửa và lưu có ở giai đoạn C">
            <LockSimple weight="bold" aria-hidden="true" />
            Chỉ xem
          </span>
          <Button icon={ArrowClockwise} variant="quiet" busy={props.loading} onClick={props.onReload}>
            Tải lại
          </Button>
        </>
      }
    />
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
