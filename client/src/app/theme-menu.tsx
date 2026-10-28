import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { setTheme, useTheme, type ThemePreference } from "@/lib/theme";

const ICONS = { system: Desktop, light: Sun, dark: Moon } as const;

export function ThemeMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const Current = ICONS[preference];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? "icon-sm" : "sm"} aria-label={t("theme.label")} className={compact ? undefined : "w-full justify-start"}>
          <Current aria-hidden />
          {!compact && t(`theme.${preference}`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setTheme(v as ThemePreference)}>
          {(["system", "light", "dark"] as const).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(`theme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
