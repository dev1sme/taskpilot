import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import type { BackupEntry } from "../../api/types";
import { Button } from "../../components/Button";
import { DiffDialog } from "../../components/DiffDialog";
import { toast } from "../../components/Toast";
import { useWorkspace } from "../../app/workspace";
import { ConfigHeader, EmptyCard, LoadError } from "./parts";
import { useConfig } from "./useConfig";
import "../tasks/tasks.css";

/** Every backup TaskPilot took before writing a config file; any of them can be restored. */
export function BackupsPage() {
  const { data, error, loading, reload } = useConfig(api.backups);
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
      setDiff((await api.backupDiff(b.id)).diff);
    } catch (e) {
      setRestoreError((e as Error).message);
      setDiff("");
    }
  };

  const restore = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await api.restoreBackup(picked.id);
      toast(`Đã khôi phục ${picked.display}. Bản trước đó cũng đã được backup.`);
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
      <ConfigHeader
        title="Lịch sử thay đổi"
        subtitle="Bản sao TaskPilot lưu ngay trước mỗi lần ghi file cấu hình (~/.taskpilot/backups)"
        loading={loading}
        onReload={() => void reload()}
        actions={<span />}
      />
      <LoadError error={error} />
      <div className="page-body">
        {data && data.length === 0 ? (
          <EmptyCard title="Chưa có thay đổi nào">Khi ba lưu CLAUDE.md, quyền hay cấu hình khác trong TaskPilot, bản cũ sẽ hiện ở đây.</EmptyCard>
        ) : (
          <table className="task-table backups-table">
            <thead>
              <tr>
                <th scope="col">Thời điểm</th>
                <th scope="col">File</th>
                <th scope="col">Lý do</th>
                <th scope="col">Bản cũ</th>
                <th scope="col">
                  <span className="sr-only">Hành động</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="mono muted">{new Date(b.at).toLocaleString("vi-VN")}</td>
                  <td className="mono">{b.display}</td>
                  <td className="muted">{b.reason}</td>
                  <td className="muted">{b.existed ? `${b.bytes} byte` : "chưa có file"}</td>
                  <td>
                    <Button icon={ArrowCounterClockwise} variant="quiet" disabled={b.restorable === false} onClick={() => void open(b)}>
                      Xem &amp; khôi phục
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
        title={picked ? `Khôi phục ${picked.display} về bản lúc ${new Date(picked.at).toLocaleTimeString("vi-VN")}` : ""}
        diff={diff}
        changed={diff === null ? undefined : diff.includes("@@") || !picked?.existed}
        busy={busy}
        error={restoreError}
        confirmLabel={picked?.existed ? "Khôi phục" : "Khôi phục (xoá file hiện tại)"}
        onConfirm={() => void restore()}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}
