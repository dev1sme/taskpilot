import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(E2E_DIR, "..");
export const TMP = path.join(E2E_DIR, ".tmp");
export const AUTH_FILE = path.join(E2E_DIR, ".auth/user.json");

// Ports apart from dev (8791 + vite 5173) and the service (8790), so a running TaskPilot is untouched.
export const SERVER_PORT = 8891;
export const CLIENT_PORT = 5273;
export const BASE_URL = `http://127.0.0.1:${CLIENT_PORT}`;

export const E2E_USER = "e2e";
export const E2E_PASSWORD = "e2e-password";

// State, ~/.claude and ~/.claude.json point into e2e/.tmp: the app under test never touches the real ones.
// Non-empty credentials win over the app's .env (loadDotEnv treats empty values as unset).
export const SERVER_ENV: Record<string, string> = {
  TASKPILOT_HOST: "127.0.0.1",
  TASKPILOT_PORT: String(SERVER_PORT),
  TASKPILOT_HOME: path.join(TMP, "home"),
  TASKPILOT_CLAUDE_HOME: path.join(TMP, "claude"),
  TASKPILOT_CLAUDE_JSON: path.join(TMP, "claude.json"),
  // Copilot sessions install their hooks under COPILOT_HOME.
  COPILOT_HOME: path.join(TMP, "copilot"),
  TASKPILOT_AUTH_USER: E2E_USER,
  TASKPILOT_AUTH_PASSWORD: E2E_PASSWORD,
  TASKPILOT_TOKEN: "e2e-token",
  // Sessions started by a test run a stand-in, never the real claude.
  TASKPILOT_CLAUDE: path.join(E2E_DIR, "fake-claude.sh"),
  TASKPILOT_CODEX: path.join(E2E_DIR, "fake-codex.mjs"),
  TASKPILOT_COPILOT: path.join(E2E_DIR, "fake-copilot.sh"),
};

export const CLIENT_ENV: Record<string, string> = { TASKPILOT_PORT: String(SERVER_PORT) };
