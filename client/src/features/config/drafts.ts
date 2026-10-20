import { useSyncExternalStore } from "react";

/**
 * Unsaved edits, kept outside the pages so leaving a page and coming back keeps the draft.
 * Keys look like "memory:project" or "settings:local".
 */
const drafts = new Map<string, unknown>();
/** What each draft started as (serialized): a draft equal to it has no unsaved changes. */
const baselines = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function getDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

/**
 * Opening a draft (first set for a key) records `baseline` as its starting point; it defaults to the
 * value itself. Pass `null` for content that is not on disk yet, so it counts as unsaved from the start.
 */
export function setDraft(key: string, value: unknown, baseline: unknown = value): void {
  if (!drafts.has(key)) baselines.set(key, JSON.stringify(baseline));
  drafts.set(key, value);
  changed();
}

export function clearDraft(key: string): void {
  baselines.delete(key);
  if (drafts.delete(key)) changed();
}

/** The draft differs from what it was opened with. */
export function isDirty(key: string): boolean {
  return drafts.has(key) && JSON.stringify(drafts.get(key)) !== baselines.get(key);
}

export function dirtyKeys(): string[] {
  return [...drafts.keys()].filter(isDirty);
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

// Closing the tab with unsaved edits asks first.
window.addEventListener("beforeunload", (e) => {
  if (dirtyKeys().length > 0) e.preventDefault();
});
