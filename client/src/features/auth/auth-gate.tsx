import type { AuthStatus } from "@server/api-types";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { takeUrlToken, UNAUTHORIZED } from "@/lib/api";
import { authApi } from "./api";
import { LoginScreen } from "./login-screen";

let boot: Promise<AuthStatus> | null = null;

/** Once per page (StrictMode runs effects twice): trade a ?token= for a session cookie, then ask whether this browser is logged in. */
function bootstrap(): Promise<AuthStatus> {
  boot ??= (async () => {
    const token = takeUrlToken();
    if (token) await authApi.login({ token }).catch(() => undefined);
    return authApi.status();
  })();
  return boot;
}

const AuthModeContext = createContext<AuthStatus["mode"]>("token");

/** "password" when there is a login to log out of. */
export function useAuthMode(): AuthStatus["mode"] {
  return useContext(AuthModeContext);
}

function Notice({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-full place-items-center p-6 text-center">
      <div className="grid max-w-md gap-2">
        <h1 className="text-lg font-semibold">{t("appName")}</h1>
        {children}
      </div>
    </main>
  );
}

/** Renders the app only for a logged-in browser; otherwise the login screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation("auth");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().then(setStatus, (e: Error) => setError(e.message));
    const lost = () => setStatus((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener(UNAUTHORIZED, lost);
    return () => window.removeEventListener(UNAUTHORIZED, lost);
  }, []);

  if (error)
    return (
      <Notice>
        <p role="alert" className="text-danger">
          {t("unreachable", { error })}
        </p>
      </Notice>
    );
  if (!status) return null;
  if (!status.authenticated) {
    // A reload starts every query and the event stream afresh under the new session.
    if (status.mode === "password") return <LoginScreen onLoggedIn={() => location.reload()} />;
    return (
      <Notice>
        <p className="text-muted">{t("noSession")}</p>
      </Notice>
    );
  }
  return <AuthModeContext.Provider value={status.mode}>{children}</AuthModeContext.Provider>;
}
