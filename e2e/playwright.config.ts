import { defineConfig, devices } from "@playwright/test";
import { AUTH_FILE, BASE_URL, ROOT, SERVER_PORT } from "./env";

const serve = (target: string) => `node_modules/.bin/tsx e2e/serve.ts ${target}`;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /codex\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
    {
      name: "codex",
      testMatch: /codex\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      // These tests select a repo with its own workflow; run after the shared fixture suite.
      dependencies: ["chromium"],
    },
  ],
  webServer: [
    { command: serve("server"), cwd: ROOT, url: `http://127.0.0.1:${SERVER_PORT}/api/auth`, reuseExistingServer: false },
    { command: serve("client"), cwd: ROOT, url: BASE_URL, reuseExistingServer: false },
  ],
});
