import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

// typescript-eslint does not support TypeScript 7 yet; Babel parses TS/TSX syntax, which is all the hooks rules need.
export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "e2e/playwright-report/**", "e2e/test-results/**"] },
  {
    files: ["client/src/**/*.{ts,tsx}", "server/src/**/*.ts", "server/test/**/*.ts", "e2e/tests/**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ["typescript", "jsx"] } } },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
  },
];
