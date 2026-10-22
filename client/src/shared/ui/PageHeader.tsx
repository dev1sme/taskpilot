import { MagnifyingGlass } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./page-header.css";

/** Window event that opens the command palette (handled in App). */
export const OPEN_PALETTE = "taskpilot:palette";

/** Page title row: optional breadcrumb, title, subtitle, actions, and the ⌘K search button. */
export function PageHeader(props: { crumbs?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation("shell");
  return (
    <header className="page-header">
      <div className="page-heading">
        {props.crumbs && (
          <nav className="crumbs" aria-label={t("header.crumbs")}>
            {props.crumbs}
          </nav>
        )}
        <h1>{props.title}</h1>
        {props.subtitle && <p className="page-sub">{props.subtitle}</p>}
      </div>
      <div className="page-actions">
        <button type="button" className="search-trigger" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}>
          <MagnifyingGlass aria-hidden="true" />
          <span>{t("header.search")}</span>
          <kbd>{navigator.platform.startsWith("Mac") ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        {props.actions}
      </div>
    </header>
  );
}
