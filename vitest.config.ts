import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Copilot sessions install their hooks under COPILOT_HOME: keep tests out of the real ~/.copilot.
export default defineConfig({ test: { include: ["server/test/**/*.test.ts"], env: { COPILOT_HOME: path.join(os.tmpdir(), "taskpilot-vitest-copilot") } } });
