import type { ConfigScope } from "../shared/sections.js";
import type { NativeFields } from "./native.js";

export type SettingsScope = "project" | "local" | "user";

export interface HookEntry {
  scope: SettingsScope;
  file: string;
  event: string;
  matcher: string;
  type: string;
  command: string;
  timeout?: number;
}

export interface SettingsFile {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  error?: string;
  allow: string[];
  ask: string[];
  deny: string[];
  defaultMode?: string;
  additionalDirectories: string[];
  env: Array<{ key: string; value: string; reference: boolean }>;
  /** Other top-level keys, so the page can say what else the file configures. */
  otherKeys: string[];
}

export interface NativeSettingsFile {
  scope: ConfigScope;
  path: string;
  exists: boolean;
  error?: string;
  fields: NativeFields;
  editableKeys: string[];
}
