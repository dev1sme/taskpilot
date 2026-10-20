export type Scope = "project" | "local" | "user";

export interface MaskedValue {
  key: string;
  value: string;
  reference: boolean;
}

export interface RawFile {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
}

export interface Preview {
  diff: string;
  changed: boolean;
  /** The file changed on disk since it was loaded. */
  stale: boolean;
}

export interface BackupEntry {
  id: string;
  at: number;
  path: string;
  display: string;
  reason: string;
  bytes: number;
  existed: boolean;
  restorable?: boolean;
}

export interface SaveResult {
  hash: string;
  backup: BackupEntry;
}
