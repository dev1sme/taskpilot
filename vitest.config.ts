import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Apps start Codex and Claude usage pollers: point them at no binary so tests never run the real ones.
// Copilot sessions install their hooks under COPILOT_HOME: keep tests out of the real ~/.copilot.
export default defineConfig({
  test: {
    include: ["server/test/**/*.test.ts"],
    env: {
      TASKPILOT_CLAUDE: path.join(os.tmpdir(), "taskpilot-vitest-no-claude"),
      TASKPILOT_CODEX: path.join(os.tmpdir(), "taskpilot-vitest-no-codex"),
      COPILOT_HOME: path.join(os.tmpdir(), "taskpilot-vitest-copilot"),
    },
  },
});
