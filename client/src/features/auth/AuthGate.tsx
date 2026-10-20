import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { takeUrlToken, UNAUTHORIZED } from "../../shared/api/http";
import type { AuthStatus } from "../../api/types";
import { LoginScreen } from "./LoginScreen";
import "./auth.css";

let boot: Promise<AuthStatus> | null = null;

/**
 * Once per page (StrictMode runs effects twice): trade a ?token= for a session cookie, then ask the
 * server whether this browser is logged in.
 */
function bootstrap(): Promise<AuthStatus> {
  boot ??= (async () => {
    const token = takeUrlToken();
    if (token) await api.login({ token }).catch(() => undefined);
    return api.auth();
  })();
  return boot;
}

const AuthModeContext = createContext<AuthStatus["mode"]>("token");

/** "password" when there is a login to log out of. */
export function useAuthMode(): AuthStatus["mode"] {
  return useContext(AuthModeContext);
}

export async function logout(): Promise<void> {
  await api.logout().catch(() => undefined);
  location.reload();
}

/** Renders the app only for a logged-in browser; otherwise the login screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation(["auth", "common"]);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().then(setStatus, (e: Error) => setError(e.message));
    const lost = () => setStatus((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener(UNAUTHORIZED, lost);
    return () => window.removeEventListener(UNAUTHORIZED, lost);
  }, []);

  if (error) {
    return (
      <main className="empty-state">
        <h1>{t("common:appName")}</h1>
        <p role="alert">{t("unreachable", { error })}</p>
      </main>
    );
  }
  if (!status) return null;
  if (!status.authenticated) {
    if (status.mode === "password") {
      // A reload starts every query and the event stream afresh under the new session.
      return <LoginScreen onLoggedIn={() => location.reload()} />;
    }
    return (
      <main className="empty-state">
        <h1>{t("common:appName")}</h1>
        <p>{t("noSession")}</p>
      </main>
    );
  }
  return <AuthModeContext.Provider value={status.mode}>{children}</AuthModeContext.Provider>;
}
