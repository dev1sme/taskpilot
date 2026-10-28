import { useTranslation } from "react-i18next";

/** Placeholder for a screen not rebuilt yet. */
export function Pending({ title }: { title: string }) {
  const { t } = useTranslation("shell");
  return (
    <div className="grid gap-1 p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">{t("pending")}</p>
    </div>
  );
}
