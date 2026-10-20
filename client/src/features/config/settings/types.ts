import type { Scope, MaskedValue } from "../shared/types";

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
