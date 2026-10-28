import { useSyncExternalStore } from "react";

/** Whether a media query matches, kept in sync. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** A value in this browser's storage; the app works the same when storage is blocked. */
export const stored = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private window or blocked storage: the choice holds for this page view.
    }
  },
};
