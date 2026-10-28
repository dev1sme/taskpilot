export type ThemePreference = "system" | "light" | "dark";
const KEY = "taskpilot.theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let preference = readTheme();
function apply() {
  document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "light" : "dark") : preference;
}

export function setTheme(value: ThemePreference) {
  preference = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // The choice still applies when browser storage is unavailable.
  }
  apply();
  window.dispatchEvent(new Event("taskpilot:theme"));
}

media.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) {
    preference = readTheme();
    apply();
    window.dispatchEvent(new Event("taskpilot:theme"));
  }
});
apply();
