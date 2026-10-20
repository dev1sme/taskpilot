import { ArrowsOut, ChatText, Check, Diamond } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api/client";
import type { RunState, WorkflowStep } from "../../api/types";
import { Button } from "../../components/Button";
import { Markdown } from "../../components/Markdown";

/**
 * The approval gate, front and center: what Claude produced (file preview + its closing message)
 * and the two ways forward.
 */
export function GateCard(props: {
  taskKey: string;
  run: RunState;
  step: WorkflowStep;
  isLast: boolean;
  docVersion: number;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation("workflow");
  const { taskKey, step } = props;
  const docQuery = useQuery({
    queryKey: ["doc", taskKey, step.doneFile, props.docVersion],
    queryFn: () => api.file(taskKey, step.doneFile!),
    enabled: !!step.doneFile,
  });
  const doc = docQuery.data?.content ?? null;
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "feedback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackId = useId();

  const act = async (name: "approve" | "feedback", action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
      setError(null);
      if (name === "feedback") setFeedback("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      props.onChanged();
    }
  };

  return (
    <motion.section
      className="gate-card"
      aria-labelledby={`${feedbackId}-title`}
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
    >
      <header className="gate-head">
        <span className="gate-badge" aria-hidden="true">
          <Diamond weight="fill" />
        </span>
        <div>
          <h3 id={`${feedbackId}-title`}>{t("gate.title")}</h3>
          <p>
            <Trans t={t} i18nKey="gate.body" values={{ step: step.title }} components={{ strong: <strong /> }} />
            {props.isLast ? t("gate.bodyLast") : t("gate.bodyNext")}
          </p>
        </div>
      </header>

      {props.run.lastMessage && (
        <figure className="gate-claude">
          <figcaption>{t("gate.summary")}</figcaption>
          <Markdown source={props.run.lastMessage} />
        </figure>
      )}

      {step.doneFile && (
        <div className="gate-doc">
          <div className="gate-doc-head">
            <code>{step.doneFile}</code>
            <Button icon={ArrowsOut} variant="quiet" onClick={() => props.onOpenDoc(step.doneFile!)}>
              {t("gate.readAll")}
            </Button>
          </div>
          <div className="gate-doc-body">{doc !== null ? <Markdown source={doc} /> : <p className="hint">{t("gate.loading")}</p>}</div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="gate-decide">
        <Button
          icon={Check}
          variant="attention"
          size="lg"
          busy={busy === "approve"}
          disabled={busy !== null}
          onClick={() => void act("approve", () => api.approve(taskKey))}
        >
          {props.isLast ? t("gate.approveLast") : t("gate.approveNext")}
        </Button>
        <form
          className="gate-feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void act("feedback", () => api.feedback(taskKey, feedback));
          }}
        >
          <label htmlFor={feedbackId}>{t("gate.feedbackLabel")}</label>
          <div className="gate-feedback-row">
            <textarea
              id={feedbackId}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t("gate.feedbackPlaceholder")}
              rows={2}
            />
            <Button type="submit" icon={ChatText} busy={busy === "feedback"} disabled={busy !== null || !feedback.trim()}>
              {t("gate.sendFeedback")}
            </Button>
          </div>
        </form>
      </div>
    </motion.section>
  );
}
