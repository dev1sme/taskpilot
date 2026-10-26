import { ArrowClockwise, LockSimple } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { href, type Route } from "../../../shared/router";
import { Button } from "../../../shared/ui/Button";
import i18n from "../../../i18n";
import { PageHeader } from "../../../shared/ui/PageHeader";
import { toast } from "../../../shared/ui/Toast";
import { Toolbar } from "../../../shared/ui/Toolbar";
import type { ReactNode } from "react";
import "./controls.css";
import "./forms.css";
import "./cards.css";
import "./page-tabs.css";

/** Header shared by the config pages: title and subtitle only; file actions go in `ConfigToolbar`. */
export function ConfigHeader(props: { title: ReactNode; subtitle?: ReactNode }) {
  return <PageHeader title={props.title} subtitle={props.subtitle} />;
}

/** Tabs under the header between sibling pages that share one sidebar item; each tab is its page's own route. */
export function PageTabs(props: { label: string; tabs: Array<{ route: Route; label: string; current: boolean }> }) {
  return (
    <nav className="page-tabs" aria-label={props.label}>
      {props.tabs.map((tab) => (
        <a key={href(tab.route)} href={href(tab.route)} aria-current={tab.current ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

/** Workflow and its document formats: two pages, one sidebar item. */
export function WorkflowTabs({ current }: { current: "workflow" | "formats" }) {
  const { t } = useTranslation("config");
  return (
    <PageTabs
      label={t("workflow.tabsLabel")}
      tabs={[
        { route: { page: "config", section: "workflow" }, label: t("workflow.tabSteps"), current: current === "workflow" },
        { route: { page: "config", section: "formats" }, label: t("formats.title"), current: current === "formats" },
      ]}
    />
  );
}

/**
 * Toolbar of the config pages: what the page shows on the left (scope tabs…), reload and the actions
 * on what is shown on the right. `readOnly` pages get a marker in place of actions.
 */
export function ConfigToolbar(props: { start?: ReactNode; actions?: ReactNode; readOnly?: boolean; loading: boolean; onReload: () => void }) {
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

/** Confirms a change that left a backup, with a link to Lịch sử thay đổi where it can be restored. */
export function backupToast(text: string): void {
  toast(text, { action: { label: i18n.t("backupsLink", { ns: "config" }), href: href({ page: "backups" }) } });
}
