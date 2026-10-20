import type { ReactNode } from "react";
import "../../app/layout/shell.css";

/**
 * Row under the page header: what the page shows on the left (tabs, status…), the actions on what
 * is shown on the right. Page headers keep only navigation and search.
 */
export function Toolbar(props: { start?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={props.className ? `toolbar ${props.className}` : "toolbar"}>
      <div className="toolbar-start">{props.start}</div>
      <div className="toolbar-actions">{props.actions}</div>
    </div>
  );
}
