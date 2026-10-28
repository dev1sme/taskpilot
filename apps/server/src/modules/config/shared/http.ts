import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";
import type { StateStore } from "../../../core/state.js";
import type { BackupStore } from "../backups/store.js";
import type { MemoryScope } from "../memory/read.js";
import type { SettingsScope } from "../settings/read.js";

/** What every config route group needs from the app. */
export interface ConfigRouteOptions {
  requireRepo: () => string;
  /** Where the repo's chosen workflow mode is kept. */
  state: StateStore;
  backups: BackupStore;
}

export const SCOPES = ["project", "local", "user"];

export function scopeOf(raw: string): MemoryScope & SettingsScope {
  if (!SCOPES.includes(raw)) throw new HttpError(400, t("errors.invalidScope", { scope: raw }));
  return raw as MemoryScope & SettingsScope;
}

export function stringField(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string") throw new HttpError(400, t("errors.missing", { key }));
  return v;
}
