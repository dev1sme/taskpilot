import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tmp = path.join(here, ".tmp");

// Ports apart from dev (8791 + vite 5173) and the service (8790), so a running TaskPilot is untouched.
const SERVER_PORT = 8891;
const CLIENT_PORT = 5273;

export const E2E_USER = "e2e";
export const E2E_PASSWORD = "e2e-password";
export const AUTH_FILE = path.join(here, ".auth/user.json");

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      // State, ~/.claude and ~/.claude.json point into e2e/.tmp: tests never touch the real ones.
      // Non-empty credentials win over the app's .env (loadDotEnv treats empty values as unset).
      command: `rm -rf "${tmp}" && mkdir -p "${tmp}/home" "${tmp}/claude" && node_modules/.bin/tsx server/src/index.ts`,
      cwd: root,
      url: `http://127.0.0.1:${SERVER_PORT}/api/auth`,
      reuseExistingServer: false,
      env: {
        TASKPILOT_HOST: "127.0.0.1",
        TASKPILOT_PORT: String(SERVER_PORT),
        TASKPILOT_HOME: path.join(tmp, "home"),
        TASKPILOT_CLAUDE_HOME: path.join(tmp, "claude"),
        TASKPILOT_CLAUDE_JSON: path.join(tmp, "claude.json"),
        TASKPILOT_AUTH_USER: E2E_USER,
        TASKPILOT_AUTH_PASSWORD: E2E_PASSWORD,
        TASKPILOT_TOKEN: "e2e-token",
      },
    },
    {
      command: `node_modules/.bin/vite --port ${CLIENT_PORT} --strictPort`,
      cwd: root,
      url: `http://127.0.0.1:${CLIENT_PORT}`,
      reuseExistingServer: false,
      env: { TASKPILOT_PORT: String(SERVER_PORT) },
    },
  ],
});
