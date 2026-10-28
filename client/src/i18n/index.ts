import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import activity from "./locales/vi/activity.json";
import auth from "./locales/vi/auth.json";
import common from "./locales/vi/common.json";
import config from "./locales/vi/config.json";
import docs from "./locales/vi/docs.json";
import repo from "./locales/vi/repo.json";
import sessions from "./locales/vi/sessions.json";
import shell from "./locales/vi/shell.json";
import task from "./locales/vi/task.json";
import tasks from "./locales/vi/tasks.json";
import workflow from "./locales/vi/workflow.json";

/**
 * UI strings, one JSON file per feature (namespace). A second language is a sibling of `vi` with the
 * same files; `i18next.d.ts` types every `t()` key against `vi`.
 */
export const resources = { vi: { activity, auth, common, config, docs, repo, sessions, shell, task, tasks, workflow } } as const;

export const defaultNS = "common";

// Resources are bundled, so init is synchronous: the first render already has every string.
void i18n.use(initReactI18next).init({
  lng: "vi",
  fallbackLng: "vi",
  defaultNS,
  ns: Object.keys(resources.vi),
  resources,
  interpolation: { escapeValue: false }, // React escapes
  initAsync: false,
});

export default i18n;

/** Locale for `Intl` date and number formatting; follows the UI language. */
export const locale = () => i18n.language;
