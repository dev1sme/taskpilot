import { call } from "../../../shared/api/http";
import type { SettingsFile, Permissions, PermissionsFile } from "./types";
import type { Scope, Preview, SaveResult } from "../shared/types";

export const settingsApi = {
  settings: () => call<SettingsFile[]>("GET", "/api/config/settings"),
  permissions: (scope: Scope) => call<PermissionsFile>("GET", `/api/config/settings/${scope}/permissions`),
  permissionsPreview: (scope: Scope, p: Permissions, baseHash: string) => call<Preview>("POST", `/api/config/settings/${scope}/permissions/preview`, { ...p, baseHash }),
  permissionsSave: (scope: Scope, p: Permissions, baseHash: string) => call<SaveResult>("PUT", `/api/config/settings/${scope}/permissions`, { ...p, baseHash }),
};
