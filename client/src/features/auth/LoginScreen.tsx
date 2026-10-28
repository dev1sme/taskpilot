import { SignIn } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
// .brand-mark
import { BrandMark } from "../../shared/ui/BrandMark";
import { authApi } from "./api";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation(["auth", "common"]);
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
            await authApi.login({ user, password });
            onLoggedIn();
          } catch (err) {
            setError((err as Error).message);
            setPassword("");
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <BrandMark />
          <h1 id={`${id}-title`}>{t("common:appName")}</h1>
        </div>

        <label htmlFor={`${id}-user`}>{t("user")}</label>
        <input id={`${id}-user`} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />

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
