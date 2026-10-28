import { Moon, Sun, Desktop } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readTheme, setTheme, type ThemePreference } from "../theme";
import "./theme-selector.css";

export function ThemeSelector() {
  const { t } = useTranslation("shell");
  const [value, setValue] = useState(readTheme);
  useEffect(() => {
    const sync = () => setValue(readTheme());
    window.addEventListener("taskpilot:theme", sync);
    return () => window.removeEventListener("taskpilot:theme", sync);
  }, []);
  const Icon = value === "system" ? Desktop : value === "light" ? Sun : Moon;
  return (
    <label className="theme-selector" title={t("theme.label")}>
      <Icon aria-hidden="true" />
      <select
        aria-label={t("theme.label")}
        value={value}
        onChange={(event) => {
          const next = event.target.value as ThemePreference;
          setValue(next);
          setTheme(next);
        }}
      >
        <option value="system">{t("theme.system")}</option>
        <option value="light">{t("theme.light")}</option>
        <option value="dark">{t("theme.dark")}</option>
      </select>
    </label>
  );
}
