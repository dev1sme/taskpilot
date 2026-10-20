import { CheckCircle, FileText, NotePencil } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { clockTime } from "../../shared/ui/Elapsed";
import "./docs.css";
import type { WorkflowStep } from "../workflow";
import type { TaskSummary } from "../workspace";

/**
 * The task's documents: the spec the user wrote, then what Claude is expected to write, in step
 * order. Files that do not exist yet are listed (greyed) so the user sees what is coming.
 */
export function DocsPanel(props: { task: TaskSummary; steps: WorkflowStep[]; onOpen: (path: string) => void }) {
  const { t } = useTranslation("docs");
  const { task } = props;
  const outputs = new Map(task.outputFiles.map((f) => [f.path, f]));
  const expected = props.steps.flatMap((s) => s.outputs.map((o) => o.file));
  const names = [...new Set([...task.outputFiles.map((f) => f.path), ...expected])].sort();

  return (
    <aside className="docs-panel" aria-labelledby="docs-title">
      <h3 id="docs-title">{t("title")}</h3>

      <p className="docs-group">{t("spec")}</p>
      <ul>
        {task.specFiles.map((f) => (
          <li key={f.path}>
            <button type="button" className="doc-link" onClick={() => props.onOpen(f.path)}>
              <NotePencil aria-hidden="true" />
              <span className="doc-name">{f.path.replace(/^spec\//, "")}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="docs-group">{t("written")}</p>
      <ul>
        {names.map((name) => {
          const file = outputs.get(name);
          return (
            <li key={name}>
              {file ? (
                <button type="button" className="doc-link" onClick={() => props.onOpen(name)}>
                  <CheckCircle weight="fill" className="doc-ready" aria-hidden="true" />
                  <span className="doc-name">{name}</span>
                  <time className="doc-time">{clockTime(file.mtime)}</time>
                </button>
              ) : (
                <span className="doc-link is-pending">
                  <FileText aria-hidden="true" />
                  <span className="doc-name">{name}</span>
                  <span className="doc-time">{t("notYet")}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
