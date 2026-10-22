import { CheckCircle, Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { workflowConfigApi } from "./api";
import type { WorkflowConfig, WorkflowDraft } from "./types";

/** Errors and warnings of the workflow; while a file is being edited, of the workflow with that draft in it. */
export function Checks({ config, draft }: { config: WorkflowConfig; draft: WorkflowDraft | undefined }) {
  const { t } = useTranslation("config");
  const [live, setLive] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const content = draft?.content;
  const name = draft?.name;

  useEffect(() => {
    if (name === undefined || content === undefined) return setLive(null);
    // A slower answer for older text must not replace the newer one.
    let cancelled = false;
    const timer = setTimeout(() => {
      workflowConfigApi.validate(name, content).then(
        (r) => !cancelled && setLive(r),
        (e: Error) => !cancelled && setLive({ errors: [e.message], warnings: [] }),
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, content]);

  const { errors, warnings } = live ?? config;
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <p className="wf-ok">
        <CheckCircle weight="fill" aria-hidden="true" />
        {t("workflow.valid")}
      </p>
    );
  }
  return (
    <ul className="checks wf-checks-list" aria-label={t("workflow.checks")}>
      {errors.map((e) => (
        <li key={`e-${e}`} className="check-error">
          <Warning weight="fill" aria-hidden="true" />
          <span>{e}</span>
        </li>
      ))}
      {warnings.map((w) => (
        <li key={`w-${w}`} className="check-warn">
          <Warning weight="fill" aria-hidden="true" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}
