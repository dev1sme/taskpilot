import { defineConfig } from "i18next-cli";

/** i18next-cli: `npm run i18n:lint` flags UI text written inline instead of going through `t()`. */
export default defineConfig({
  locales: ["vi"],
  extract: {
    input: ["apps/web/src/**/*.{ts,tsx}"],
    ignore: ["apps/web/src/i18n/**"],
    output: "apps/web/src/i18n/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
  },
});
