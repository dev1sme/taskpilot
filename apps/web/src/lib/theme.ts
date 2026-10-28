import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "taskpilot.theme";
const CHANGED = "taskpilot:theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let preference = read();

/** Sets `data-theme` on <html>; index.html does the same before the first paint. */
function apply(): void {
  document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "light" : "dark") : preference;
}

export function setTheme(value: ThemePreference): void {
  preference = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // The choice still applies when browser storage is unavailable.
  }
  apply();
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

/** The user's choice, and the theme actually shown. */
export function useTheme(): { preference: ThemePreference; resolved: "light" | "dark" } {
  const value = useSyncExternalStore(subscribe, () => preference);
  const resolved = (document.documentElement.dataset.theme === "light" ? "light" : "dark") as "light" | "dark";
  return { preference: value, resolved };
}

media.addEventListener("change", () => {
  apply();
  window.dispatchEvent(new Event(CHANGED));
});
window.addEventListener("storage", (event) => {
  if (event.key !== KEY && event.key !== null) return;
  preference = read();
  apply();
  window.dispatchEvent(new Event(CHANGED));
});
apply();
