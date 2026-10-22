import { ChatText } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
import { composeAnswers, initialAnswers, QuestionForm } from "./QuestionForm";
import type { Question } from "./types";
import "./now-card.css";

/** Answers Claude from here: one field per question it asked, plus free text; sent into the session as it is. */
export function ReplyForm(props: { send: (text: string) => Promise<unknown>; questions: Question[]; agent: string; onChanged: () => void }) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const [answers, setAnswers] = useState(() => initialAnswers(props.questions));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = JSON.stringify(props.questions);
  const [seenAsked, setSeenAsked] = useState(asked);
  if (seenAsked !== asked) {
    setSeenAsked(asked);
    setAnswers(initialAnswers(props.questions));
  }
  const reply = [composeAnswers(props.questions, answers, t("questions.agree")), text.trim()].filter(Boolean).join("\n\n");

  return (
    <form
      className="now-reply"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        props
          .send(reply)
          .then(
            () => {
              setText("");
              setError(null);
            },
            (err: Error) => setError(err.message),
          )
          .finally(() => {
            setBusy(false);
            props.onChanged();
          });
      }}
    >
      {props.questions.length > 0 && <QuestionForm agent={props.agent} questions={props.questions} answers={answers} onChange={setAnswers} disabled={busy} />}
      <label htmlFor={id}>{props.questions.length > 0 ? t("now.replyMore") : t("now.replyLabel", { agent: props.agent })}</label>
      <div className="now-reply-row">
        <textarea id={id} rows={2} value={text} placeholder={t("now.replyPlaceholder")} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" icon={ChatText} variant="attention" busy={busy} disabled={busy || !reply}>
          {t("now.replySend")}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
