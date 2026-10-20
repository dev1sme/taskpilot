export interface AuthStatus {
  /** "password": log in with user and password. "token": open the URL the server printed. */
  mode: "password" | "token";
  authenticated: boolean;
}
