import { SignIn } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { Button } from "../../components/Button";
// .brand-mark
import "../shell/shell.css";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation("auth");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  return (
    <main className="login">
      <form
        className="login-card"
        aria-labelledby={`${id}-title`}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.login({ user, password });
            onLoggedIn();
          } catch (err) {
            setError((err as Error).message);
            setPassword("");
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
              <path d="M3 12l18-8-8 18-2-8-8-2z" />
            </svg>
          </span>
          <h1 id={`${id}-title`}>TaskPilot</h1>
        </div>

        <label htmlFor={`${id}-user`}>{t("user")}</label>
        <input
          id={`${id}-user`}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
        />

        <label htmlFor={`${id}-password`}>{t("password")}</label>
        <input
          id={`${id}-password`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />

        {error && (
          <p className="error" id={`${id}-error`} role="alert">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" icon={SignIn} busy={busy} disabled={!user || !password}>
          {t("login")}
        </Button>
      </form>
    </main>
  );
}
