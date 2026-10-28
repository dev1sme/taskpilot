import type { RunView, TaskDetail } from "@server/api-types";
import { CheckCircle, FileText, NotePencil } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { clockTime } from "@/lib/time";

const linkClass = "flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0";

/** The task's documents: the spec, then what agents are expected to write; missing files are listed greyed. */
export function DocsPanel({ task, steps, reports, onOpen }: { task: TaskDetail; steps: RunView["workflow"]["steps"]; reports?: string[]; onOpen: (path: string) => void }) {
  const { t } = useTranslation("docs");
  const outputs = new Map(task.outputFiles.map((f) => [f.path, f]));
  const expected = [...steps.flatMap((s) => s.outputs.map((o) => o.file)), ...(reports ?? [])];
  const names = [...new Set([...task.outputFiles.map((f) => f.path), ...expected])].sort();
  return (
    <section aria-labelledby="docs-title" className="grid gap-2">
      <h2 id="docs-title" className="text-sm font-semibold">
        {t("title")}
      </h2>
      <p className="text-xs font-medium text-faint">{t("spec")}</p>
      <ul className="grid">
        {task.specFiles.map((f) => (
          <li key={f.path}>
            <button type="button" className={`${linkClass} hover:bg-hover`} onClick={() => onOpen(f.path)}>
              <NotePencil className="text-muted" aria-hidden />
              <span className="min-w-0 truncate font-mono text-[13px]">{f.path.replace(/^spec\//, "")}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs font-medium text-faint">{t("written")}</p>
      <ul className="grid">
        {names.map((name) => {
          const file = outputs.get(name);
          return (
            <li key={name}>
              {file ? (
                <button type="button" className={`${linkClass} hover:bg-hover`} onClick={() => onOpen(name)}>
                  <CheckCircle weight="fill" className="text-done" aria-hidden />
                  <span className="min-w-0 truncate font-mono text-[13px]">{name}</span>
                  <time className="ml-auto shrink-0 font-mono text-[11px] text-faint">{clockTime(file.mtime)}</time>
                </button>
              ) : (
                <span className={`${linkClass} text-faint`}>
                  <FileText aria-hidden />
                  <span className="min-w-0 truncate font-mono text-[13px]">{name}</span>
                  <span className="ml-auto shrink-0 text-[11px]">{t("notYet")}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
