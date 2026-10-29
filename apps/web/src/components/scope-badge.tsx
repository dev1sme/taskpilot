import type { ConfigScope } from "@taskpilot/server/api-types";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/** Consistent label for the origin/scope of a configuration file or item. */
export function ScopeBadge({ scope }: { scope: ConfigScope }) {
  const { t } = useTranslation("config");
  return <Badge className="min-w-[5.25rem] justify-center px-2.5 py-1 leading-none text-ink">{t(`scope.${scope}`)}</Badge>;
}
