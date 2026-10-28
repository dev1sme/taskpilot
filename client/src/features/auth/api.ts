import type { AuthStatus } from "@server/api-types";
import { call } from "@/lib/api";

export const authApi = {
  status: () => call<AuthStatus>("GET", "/api/auth"),
  login: (body: { user: string; password: string } | { token: string }) => call<{ ok: true }>("POST", "/api/login", body),
  logout: () => call<{ ok: true }>("POST", "/api/logout"),
};

export async function logout(): Promise<void> {
  await authApi.logout().catch(() => undefined);
  location.reload();
}
