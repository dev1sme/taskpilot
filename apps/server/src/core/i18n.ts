import i18next from "i18next";
import vi from "./locales/vi.js";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof vi };
  }
}

const i18n = i18next.createInstance();

// Resources are bundled, so init is synchronous.
void i18n.init({
  lng: "vi",
  fallbackLng: "vi",
  resources: { vi: { translation: vi } },
  interpolation: { escapeValue: false }, // JSON for the UI, not HTML
  initAsync: false,
});

/** Strings the server sends to the UI, in the server's language. */
export const t = i18n.t.bind(i18n);

/** Locale for `Intl` date formatting in server-made strings. */
export const locale = () => i18n.language;
