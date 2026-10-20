import { useSyncExternalStore } from "react";

/**
 * Unsaved edits, kept outside the pages so leaving a page and coming back keeps the draft.
 * Keys look like "memory:project" or "settings:local".
 */
const drafts = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function getDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

export function setDraft(key: string, value: unknown): void {
  drafts.set(key, value);
  changed();
}

export function clearDraft(key: string): void {
  if (drafts.delete(key)) changed();
}

export function draftKeys(): string[] {
  return [...drafts.keys()];
}

/** Re-renders when any draft is added or removed. */
export function useDrafts(): string[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return draftKeys();
}

// Closing the tab with unsaved edits asks first.
window.addEventListener("beforeunload", (e) => {
  if (drafts.size > 0) e.preventDefault();
});
