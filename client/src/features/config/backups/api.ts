import { call } from "../../../shared/api/http";
import type { BackupEntry, SaveResult } from "../shared/types";

export const backupsApi = {
  backups: () => call<BackupEntry[]>("GET", "/api/backups"),
  backupDiff: (id: string) => call<{ diff: string; entry: BackupEntry }>("GET", `/api/backups/${id}/diff`),
  restoreBackup: (id: string) => call<SaveResult>("POST", `/api/backups/${id}/restore`, {}),
};
