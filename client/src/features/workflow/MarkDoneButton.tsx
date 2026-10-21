import { CheckFat } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";

/**
 * "Đánh dấu xong" for work whose agent sends no Stop: asks once more before it ends the step, since
 * the agent may still be working. The server refuses unless the step's file was written.
 */
export function MarkDoneButton(props: { complete: () => Promise<unknown>; onChanged: () => void; onError: (message: string | null) => void }) {
  const { t } = useTranslation("workflow");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await props.complete();
      props.onError(null);
    } catch (e) {
      props.onError((e as Error).message);
    } finally {
      setBusy(false);
      setAsking(false);
      props.onChanged();
    }
  };
  if (!asking) {
    return (
      <Button icon={CheckFat} variant="attention" onClick={() => setAsking(true)}>
        {t("markDone.button")}
      </Button>
    );
  }
  return (
    <span className="mark-done-confirm" role="group" aria-label={t("markDone.button")}>
      <span className="mark-done-hint">{t("markDone.hint")}</span>
      <Button icon={CheckFat} variant="attention" busy={busy} onClick={() => void run()}>
        {t("markDone.confirm")}
      </Button>
      <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
        {t("markDone.cancel")}
      </Button>
    </span>
  );
}
