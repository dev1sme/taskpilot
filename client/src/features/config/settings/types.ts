import type { Scope, MaskedValue } from "../shared/types";
import type { ProviderId } from "../../../shared/providers";

export interface SettingsFile {
  scope: Scope;
  path: string;
  exists: boolean;
  error?: string;
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode?: string;
  additionalDirectories: string[];
  env: MaskedValue[];
  otherKeys: string[];
}

export interface Permissions {
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode: string | null;
}

export interface PermissionsFile extends Permissions {
  path: string;
  exists: boolean;
  hash: string;
}

export type NativeCli = Exclude<ProviderId, "claude">;
export type NativeValue = string | boolean | null;
export type NativeFields = Record<string, NativeValue>;

export interface NativeSettingsFile {
  scope: Scope;
  path: string;
  exists: boolean;
  error?: string;
  fields: NativeFields;
  editableKeys: string[];
}

export interface NativeSettingsDetail {
  path: string;
  exists: boolean;
  hash: string;
  fields: NativeFields;
}
