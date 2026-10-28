import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

// typescript-eslint does not support TypeScript 7 yet; Babel parses TS/TSX syntax, which is all the hooks rules need.
export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "apps/server/types/**", "e2e/playwright-report/**", "e2e/test-results/**"] },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "apps/server/src/**/*.ts", "apps/server/test/**/*.ts", "packages/*/src/**/*.ts", "e2e/tests/**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] } } },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules, "react-hooks/exhaustive-deps": "error" },
  },
];
