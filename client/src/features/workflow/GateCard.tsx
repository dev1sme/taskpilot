import { ArrowsOut, ChatText, Check, Diamond } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { PROVIDER_LABELS } from "../../shared/providers";
import { AgentBadge } from "../../shared/ui/AgentBadge";
import { Button } from "../../shared/ui/Button";
import { Markdown } from "../../shared/ui/Markdown";
import { useWorkspace, workspaceApi } from "../workspace";
import { workflowApi } from "./api";
import { composeAnswers, initialAnswers, QuestionForm } from "./QuestionForm";
import { AssignmentPreview } from "./SubtaskTree";
import type { ParsedAssignments, Question, RunState, WorkflowStep } from "./types";
import "./gate-card.css";

/**
 * The approval gate, front and center: what Claude produced (file preview + its closing message),
 * its open questions with one answer field each, and the two ways forward.
 */
export function GateCard(props: {
  taskKey: string;
  run: RunState;
  step: WorkflowStep;
  questions: Question[];
  /** When the next step is a dispatch step: the subtasks the plan's table gives. */
  assignments: ParsedAssignments | null;
  /** Concurrency of that dispatch step. */
  parallel: number;
  maxSubtasks?: number;
  isLast: boolean;
  docVersion: number;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation("workflow");
  const { taskKey, step } = props;
  const { repo } = useWorkspace();
  const effective = step.effective ?? step;
  const agent = PROVIDER_LABELS[effective.agent];
  const docQuery = useQuery({
    queryKey: ["doc", taskKey, step.doneFile, props.docVersion, repo?.path],
    queryFn: () => workspaceApi.file(taskKey, step.doneFile!),
    enabled: !!step.doneFile,
  });
  const doc = docQuery.data?.content ?? null;
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "feedback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackId = useId();
  const [answers, setAnswers] = useState(() => initialAnswers(props.questions));
  const asked = JSON.stringify(props.questions);
  // New questions (Claude revised the document) start from their own proposals.
  const [seenAsked, setSeenAsked] = useState(asked);
  if (seenAsked !== asked) {
    setSeenAsked(asked);
    setAnswers(initialAnswers(props.questions));
  }
  const answered = composeAnswers(props.questions, answers, t("questions.agree"));
  const feedbackText = [answered, feedback.trim()].filter(Boolean).join("\n\n");

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
          <h3 id={`${feedbackId}-title`}>
            {t("gate.title")} <AgentBadge agent={effective.agent} />
          </h3>
          <p>
            <Trans t={t} i18nKey="gate.body" values={{ step: step.title }} components={{ strong: <strong /> }} />
            {props.isLast ? t("gate.bodyLast") : t("gate.bodyNext")}
          </p>
        </div>
      </header>
      <p className="now-sub">{t("selection.effective", { agent, model: effective.model ?? t("selection.defaultModel") })}</p>

      {props.run.lastMessage && (
        <figure className="gate-claude">
          <figcaption>{t("gate.summary", { agent })}</figcaption>
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

      {props.assignments && <AssignmentPreview assignments={props.assignments} parallel={props.parallel} maxSubtasks={props.maxSubtasks} />}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="gate-decide">
        {props.questions.length > 0 && <QuestionForm agent={agent} questions={props.questions} answers={answers} onChange={setAnswers} disabled={busy !== null} />}
        {answered && <p className="gate-hint">{t("questions.approveHint")}</p>}
        <Button
          icon={Check}
          variant="attention"
          size="lg"
          busy={busy === "approve"}
          disabled={busy !== null || (props.assignments?.errors.length ?? 0) > 0}
          onClick={() => void act("approve", () => workflowApi.approve(taskKey, answered))}
        >
          {answered ? (props.isLast ? t("gate.approveLastAnswered") : t("gate.approveNextAnswered")) : props.isLast ? t("gate.approveLast") : t("gate.approveNext")}
        </Button>
        <form
          className="gate-feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void act("feedback", () => workflowApi.feedback(taskKey, feedbackText));
          }}
        >
          <label htmlFor={feedbackId}>{answered ? t("gate.feedbackLabelAnswered", { agent }) : t("gate.feedbackLabel", { agent })}</label>
          <div className="gate-feedback-row">
            <textarea id={feedbackId} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t("gate.feedbackPlaceholder")} rows={2} />
            <Button type="submit" icon={ChatText} busy={busy === "feedback"} disabled={busy !== null || !feedbackText}>
              {t("gate.sendFeedback")}
            </Button>
          </div>
        </form>
      </div>
    </motion.section>
  );
}
