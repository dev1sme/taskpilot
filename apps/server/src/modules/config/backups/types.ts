export interface BackupEntry {
  id: string;
  at: number;
  /** Absolute path of the file that was backed up. */
  path: string;
  display: string;
  reason: string;
  bytes: number;
  /** False when the file did not exist yet (the write created it). */
  existed: boolean;
}

/** A backup as listed: restorable when its file is one of this repo's config files. */
export type BackupView = BackupEntry & { restorable: boolean };

/** What restoring a backup would change: the current file to the backup's content. */
export interface BackupDiff {
  diff: string;
  entry: BackupEntry;
}
