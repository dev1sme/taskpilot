import { call } from "../../shared/api/http";
import type { AuthStatus } from "./types";

export const authApi = {
  auth: () => call<AuthStatus>("GET", "/api/auth"),
  login: (body: { user: string; password: string } | { token: string }) => call<{ ok: true }>("POST", "/api/login", body),
  logout: () => call<{ ok: true }>("POST", "/api/logout"),
};
