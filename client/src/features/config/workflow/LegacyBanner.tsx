import { ArrowUUpLeft } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { workflowConfigApi } from "./api";
import type { MigrationPreview, WorkflowConfig } from "./types";

/** A complete override (the old format): offers to rewrite it as `extends`, with a diff to review first. */
export function LegacyBanner({ config, onDone }: { config: WorkflowConfig; onDone: () => void }) {
  const { t } = useTranslation("config");
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    try {
      setPreview(await workflowConfigApi.migrate({}));
      setFailure(null);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await workflowConfigApi.migrate({ apply: true, hashes: Object.fromEntries(config.files.map((f) => [f.name, f.hash])) });
      if (!res.applied) return setFailure(res.errors.join("; "));
      toast(t("workflow.legacy.applied"));
      setPreview(null);
      onDone();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card wf-legacy">
      <h2 className="card-title">{t("workflow.legacy.title")}</h2>
      <p className="alert-warn">{t("workflow.legacy.body", { dir: config.overrideDir })}</p>
      <Button icon={ArrowUUpLeft} busy={busy} onClick={() => void open()}>
        {t("workflow.legacy.migrate")}
      </Button>
      <DiffDialog
        open={preview !== null}
        title={t("workflow.legacy.base", { base: preview?.base ?? "" })}
        diff={preview?.diff ?? null}
        changed
        busy={busy}
        error={failure ?? (preview?.errors.length ? `${t("workflow.legacy.blocked")} ${preview.errors.join("; ")}` : null)}
        confirmLabel={t("workflow.legacy.confirm")}
        onConfirm={() => void apply()}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}
