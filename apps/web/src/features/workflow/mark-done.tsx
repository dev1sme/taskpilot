import { CheckFat } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * "Đánh dấu xong" for work whose agent sends no Stop: asks once more before it ends the step, since
 * the agent may still be working. The server refuses unless the step's file was written.
 */
export function MarkDoneButton({ complete, onDone }: { complete: () => Promise<unknown>; onDone: () => void }) {
  const { t } = useTranslation("workflow");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await complete();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setAsking(false);
      onDone();
    }
  };
  if (!asking)
    return (
      <Button variant="attention" onClick={() => setAsking(true)}>
        <CheckFat aria-hidden />
        {t("markDone.button")}
      </Button>
    );
  return (
    <span role="group" aria-label={t("markDone.button")} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{t("markDone.hint")}</span>
      <Button variant="attention" busy={busy} onClick={() => void run()}>
        <CheckFat aria-hidden />
        {t("markDone.confirm")}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
        {t("markDone.cancel")}
      </Button>
    </span>
  );
}
