import { useSyncExternalStore } from "react";
import { queryClient } from "../../../shared/api/query-client";
import type { ProviderId } from "../../../shared/providers";
import type { RepoInfo } from "../../workspace";

/**
 * Unsaved edits, kept outside the pages so leaving a page and coming back keeps the draft.
 * Native keys include their CLI, for example "claude:memory:project" or "codex:memory:user".
 *
 * A draft belongs to the repo that was open when it was made: switching repo hides it, switching back
 * shows it again. Only drafts of the same CLI and user-wide file (keys ending in ":user") are
 * shared between repos. The maps hold the stored key, `<repo path>\0<key>` or the bare user-wide key.
 */
const drafts = new Map<string, unknown>();
/** What each draft started as (serialized): a draft equal to it has no unsaved changes. */
const baselines = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
const SEP = "\u0000";
const NATIVE = /^(memory|settings|hooks|library|mcp):/;
const PREFIXED = /^(claude|copilot|codex):/;

/** Call from native config pages when constructing a key. Include the file identity before the final scope. */
export function configDraftKey(cli: ProviderId, key: string): string {
  return `${cli}:${key}`;
}

/** Legacy Claude pages still pass unqualified keys until their CLI-aware editors are installed. */
function normalized(key: string): string {
  return NATIVE.test(key) && !PREFIXED.test(key) ? configDraftKey("claude", key) : key;
}

/** Read from the ["repo"] query, which the workspace keeps current, so no store of its own goes stale. */
function repoPath(): string {
  return queryClient.getQueryData<RepoInfo>(["repo"])?.path ?? "";
}

function stored(key: string): string {
  const qualified = normalized(key);
  return /:user$/.test(qualified) ? qualified : `${repoPath()}${SEP}${qualified}`;
}

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function getDraft<T>(key: string): T | undefined {
  return drafts.get(stored(key)) as T | undefined;
}

/**
 * Opening a draft (first set for a key) records `baseline` as its starting point; it defaults to the
 * value itself. Pass `null` for content that is not on disk yet, so it counts as unsaved from the start.
 */
export function setDraft(key: string, value: unknown, baseline: unknown = value): void {
  const k = stored(key);
  if (!drafts.has(k)) baselines.set(k, JSON.stringify(baseline));
  drafts.set(k, value);
  changed();
}

export function clearDraft(key: string): void {
  const k = stored(key);
  baselines.delete(k);
  if (drafts.delete(k)) changed();
}

function storedDirty(k: string): boolean {
  return drafts.has(k) && JSON.stringify(drafts.get(k)) !== baselines.get(k);
}

/** The draft differs from what it was opened with. */
export function isDirty(key: string): boolean {
  return storedDirty(stored(key));
}

/** Keys with unsaved changes in the open repo, user-wide ones included; drafts of other repos are left out. */
export function dirtyKeys(): string[] {
  const prefix = `${repoPath()}${SEP}`;
  const keys: string[] = [];
  for (const k of drafts.keys()) {
    if (!storedDirty(k)) continue;
    if (!k.includes(SEP)) keys.push(k);
    else if (k.startsWith(prefix)) keys.push(k.slice(prefix.length));
  }
  return keys;
}

/** Re-renders when any draft changes; returns the keys with unsaved changes. */
export function useDrafts(): string[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return dirtyKeys();
}

// Closing the tab with unsaved edits asks first, whichever repo they belong to.
window.addEventListener("beforeunload", (e) => {
  if ([...drafts.keys()].some(storedDirty)) e.preventDefault();
});
