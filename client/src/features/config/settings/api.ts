import { call } from "../../../shared/api/http";
import type { SettingsFile, Permissions, PermissionsFile, NativeCli, NativeFields, NativeSettingsFile, NativeSettingsDetail } from "./types";
import type { Scope, Preview, SaveResult } from "../shared/types";

export const settingsApi = {
  settings: () => call<SettingsFile[]>("GET", "/api/config/settings"),
  permissions: (scope: Scope) => call<PermissionsFile>("GET", `/api/config/settings/${scope}/permissions`),
  permissionsPreview: (scope: Scope, p: Permissions, baseHash: string) => call<Preview>("POST", `/api/config/settings/${scope}/permissions/preview`, { ...p, baseHash }),
  permissionsSave: (scope: Scope, p: Permissions, baseHash: string) => call<SaveResult>("PUT", `/api/config/settings/${scope}/permissions`, { ...p, baseHash }),
  nativeSettings: (cli: NativeCli) => call<NativeSettingsFile[]>("GET", `/api/config/settings?cli=${cli}`),
  nativeDetail: (cli: NativeCli, scope: Scope) => call<NativeSettingsDetail>("GET", `/api/config/settings/${scope}/native?cli=${cli}`),
  nativePreview: (cli: NativeCli, scope: Scope, fields: NativeFields, baseHash: string) =>
    call<Preview>("POST", `/api/config/settings/${scope}/native/preview?cli=${cli}`, { fields, baseHash }),
  nativeSave: (cli: NativeCli, scope: Scope, fields: NativeFields, baseHash: string) => call<SaveResult>("PUT", `/api/config/settings/${scope}/native?cli=${cli}`, { fields, baseHash }),
};
