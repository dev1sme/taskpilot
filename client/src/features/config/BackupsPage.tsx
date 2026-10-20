import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
import { DiffDialog } from "../../shared/ui/DiffDialog";
import { toast } from "../../shared/ui/Toast";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { locale } from "../../i18n";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "./parts";
import { useConfig } from "./useConfig";
import "../tasks/tasks.css";
import { configApi } from "./api";
import type { BackupEntry } from "./types";

/** Every backup TaskPilot took before writing a config file; any of them can be restored. */
export function BackupsPage() {
  const { t } = useTranslation("backups");
  const { data, error, loading, reload } = useConfig(["backups"], configApi.backups);
  const { reloadInventory } = useWorkspace();
  const [picked, setPicked] = useState<BackupEntry | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const open = async (b: BackupEntry) => {
    setPicked(b);
    setDiff(null);
    setRestoreError(null);
    try {
      setDiff((await configApi.backupDiff(b.id)).diff);
    } catch (e) {
      setRestoreError((e as Error).message);
      setDiff("");
    }
  };

  const restore = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await configApi.restoreBackup(picked.id);
      toast(t("restored", { file: picked.display }));
      setPicked(null);
      void reload();
      void reloadInventory();
    } catch (e) {
      setRestoreError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <ConfigHeader title={t("title")} subtitle={t("subtitle")} />
      <ConfigToolbar loading={loading} onReload={() => void reload()} />
      <LoadError error={error} />
      <div className="page-body">
        {data && data.length === 0 ? (
          <EmptyCard title={t("emptyTitle")}>{t("emptyBody")}</EmptyCard>
        ) : (
          <table className="task-table backups-table">
            <thead>
              <tr>
                <th scope="col">{t("col.at")}</th>
                <th scope="col">{t("col.file")}</th>
                <th scope="col">{t("col.reason")}</th>
                <th scope="col">{t("col.old")}</th>
                <th scope="col">
                  <span className="sr-only">{t("col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="mono muted">{new Date(b.at).toLocaleString(locale())}</td>
                  <td className="mono">{b.display}</td>
                  <td className="muted">{b.reason}</td>
                  <td className="muted">{b.existed ? t("bytes", { count: b.bytes }) : t("noFile")}</td>
                  <td>
                    <Button icon={ArrowCounterClockwise} variant="quiet" disabled={b.restorable === false} onClick={() => void open(b)}>
                      {t("open")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <DiffDialog
        open={picked !== null}
        title={picked ? t("dialogTitle", { file: picked.display, time: new Date(picked.at).toLocaleTimeString(locale()) }) : ""}
        diff={diff}
        changed={diff === null ? undefined : diff.includes("@@") || !picked?.existed}
        busy={busy}
        error={restoreError}
        confirmLabel={picked?.existed ? t("restore") : t("restoreDelete")}
        onConfirm={() => void restore()}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}
