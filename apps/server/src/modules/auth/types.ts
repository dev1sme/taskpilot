import type { AuthMode } from "./login-sessions.js";

/** Whether this browser is logged in, and how it would log in. */
export interface AuthStatus {
  /** "password": log in with user and password. "token": open the URL the server printed. */
  mode: AuthMode;
  authenticated: boolean;
}
