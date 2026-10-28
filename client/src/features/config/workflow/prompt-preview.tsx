import type { WorkflowConfigView } from "@server/api-types";
import { Eye } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { workflowConfigApi } from "./queries";

type Kind = "prompt" | "onReject" | "subtask";

/** The prompt a step would send, for a sample task: what agents actually read. */
export function PromptPreview({ data, mode }: { data: WorkflowConfigView; mode?: string }) {
  const { t } = useTranslation("config");
  const id = useId();
  const steps = data.def?.steps ?? [];
  const [stepId, setStepId] = useState(steps[0]?.id ?? "");
  const step = steps.find((s) => s.id === stepId);
  const kinds: Kind[] = step?.dispatch ? ["subtask"] : step?.onRejectFile ? ["prompt", "onReject"] : ["prompt"];
  const [kind, setKind] = useState<Kind>("prompt");
  const actualKind = kinds.includes(kind) ? kind : kinds[0];
  const [restart, setRestart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!steps.length) return null;
  const render = async () => {
    setBusy(true);
    setError(null);
    try {
      const rendered = await workflowConfigApi.render({ stepId, kind: actualKind, feedback: "", restart, drafts: {}, mode });
      setResult({ text: rendered.text, key: rendered.task.key });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="flex min-h-10 items-center px-3 text-sm font-medium">{t("workflow.preview.title")}</summary>
      <div className="grid gap-3 border-t border-line p-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-step`} className="text-xs text-muted">
              {t("workflow.preview.step")}
            </Label>
            <Select value={stepId} onValueChange={setStepId}>
              <SelectTrigger id={`${id}-step`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {steps.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-kind`} className="text-xs text-muted">
              {t("workflow.preview.kind")}
            </Label>
            <Select value={actualKind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id={`${id}-kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`workflow.preview.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button busy={busy} onClick={() => void render()}>
            <Eye aria-hidden />
            {t("workflow.preview.render")}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--signal)]" checked={restart} onChange={(e) => setRestart(e.target.checked)} />
          {t("workflow.preview.restart")}
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {result && (
          <>
            <p className="text-xs text-muted">{t("workflow.preview.sample", { key: result.key })}</p>
            <pre className="max-h-[50vh] overflow-auto rounded-sm bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{result.text}</pre>
          </>
        )}
      </div>
    </details>
  );
}
