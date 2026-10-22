import { ArrowUUpLeft, GitDiff, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/ui/Toast";
import { workflowConfigApi } from "./api";
import type { WorkflowFile } from "./types";
import { WORKFLOW_FILE } from "./workflow-files";

export function FileView(props: { file: WorkflowFile; editable: boolean; confirmDelete: boolean; busy: boolean; onDelete: () => void; onRestore: () => void }) {
  const { t } = useTranslation("config");
  const { file } = props;
  const [diff, setDiff] = useState<string | null>(null);
  const fileId = `${file.name}:${file.hash}`;
  const [seenFile, setSeenFile] = useState(fileId);
  if (seenFile !== fileId) {
    setSeenFile(fileId);
    setDiff(null);
  }

  const lines = (diff ?? "").split("\n").filter((l) => !/^(={3,}|-{3} |\+{3} |Index: |\\ No newline)/.test(l));
  return (
    <section className="code-view wf-file" aria-label={t("library.contentLabel", { path: file.path })}>
      <div className="code-head">
        <span className="mono">{file.path}</span>
        <span className="code-meta">{file.usedBy.length > 0 ? t("workflow.usedBy", { steps: file.usedBy.join(", ") }) : file.name === WORKFLOW_FILE ? "" : t("workflow.unused")}</span>
        {props.editable && file.sameAsDefault === false && (
          <Button
            icon={GitDiff}
            variant="quiet"
            onClick={() =>
              diff === null
                ? void workflowConfigApi.defaultDiff(file.name).then(
                    (r) => setDiff(r.diff),
                    (e: Error) => toast(e.message, { error: true }),
                  )
                : setDiff(null)
            }
          >
            {diff === null ? t("workflow.compare") : t("workflow.hideCompare")}
          </Button>
        )}
        {props.editable && file.sameAsDefault === false && (
          <Button icon={ArrowUUpLeft} variant="quiet" busy={props.busy} title={t("workflow.restoreTitle")} onClick={props.onRestore}>
            {t("workflow.restore")}
          </Button>
        )}
        {props.editable && file.name !== WORKFLOW_FILE && file.usedBy.length === 0 && (
          <Button icon={Trash} variant={props.confirmDelete ? "danger" : "quiet"} busy={props.busy} onClick={props.onDelete}>
            {props.confirmDelete ? t("action.deleteConfirm") : t("action.delete")}
          </Button>
        )}
      </div>
      {diff !== null ? (
        <pre className="diff-view" aria-label={t("workflow.compare")}>
          {lines.map((l, i) => (
            <span key={i} className={l.startsWith("+") ? "is-add" : l.startsWith("-") ? "is-del" : l.startsWith("@@") ? "is-hunk" : undefined}>
              {l || " "}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : (
        <ol className="code-lines">
          {file.content.split("\n").map((text, i) => (
            <li key={i}>
              <span className="ln" aria-hidden="true">
                {i + 1}
              </span>
              <span className="lt">{highlightVars(text)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** {{variables}} stand out in prompt text. */
function highlightVars(text: string) {
  if (!text) return " ";
  return text.split(/(\{\{[\w.]+\}\})/g).map((part, i) =>
    /^\{\{[\w.]+\}\}$/.test(part) ? (
      <span key={i} className="wf-var">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
