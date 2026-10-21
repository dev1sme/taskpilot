import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { Question } from "./types";
import "./question-form.css";

/** The answer to one question: its proposal, an own answer, or none yet. */
export interface Answer {
  mode: "proposal" | "other" | "skip";
  text: string;
}

export type Answers = Record<number, Answer>;

/** Questions with a proposal start on it: agreeing is the common case, one click less. */
export function initialAnswers(questions: Question[]): Answers {
  return Object.fromEntries(questions.map((q) => [q.n, { mode: q.proposal ? "proposal" : "other", text: "" }]));
}

/**
 * The answers as one text for Claude, question by question ("1. <question>\n   → <answer>");
 * unanswered questions are left out. Empty when nothing is answered.
 */
export function composeAnswers(questions: Question[], answers: Answers, agree: string): string {
  return questions
    .flatMap((q) => {
      const a = answers[q.n];
      const reply = a?.mode === "proposal" && q.proposal ? `${agree}: ${q.proposal}` : a?.mode === "other" ? a.text.trim() : "";
      return reply ? [`${q.n}. ${q.text}\n   → ${reply.replace(/\n/g, "\n     ")}`] : [];
    })
    .join("\n");
}

/** One field per question Claude asked: take its proposal or write another answer. */
export function QuestionForm(props: { questions: Question[]; answers: Answers; onChange: (answers: Answers) => void; disabled?: boolean; agent: string }) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const set = (n: number, patch: Partial<Answer>) => props.onChange({ ...props.answers, [n]: { ...props.answers[n], ...patch } });

  return (
    <fieldset className="questions" disabled={props.disabled}>
      <legend>{t("questions.title", { count: props.questions.length, agent: props.agent })}</legend>
      <ol>
        {props.questions.map((q) => {
          const a = props.answers[q.n] ?? { mode: "skip", text: "" };
          const name = `${id}-${q.n}`;
          return (
            <li key={q.n} className="question">
              <p className="question-text">
                <span className="question-n">{q.n}.</span> {q.text}
              </p>
              {q.proposal && (
                <div className="question-choices" role="radiogroup" aria-label={t("questions.choices", { n: q.n })}>
                  <label>
                    <input type="radio" name={name} checked={a.mode === "proposal"} onChange={() => set(q.n, { mode: "proposal" })} />
                    <span>
                      {t("questions.agree")}: <strong>{q.proposal}</strong>
                    </span>
                  </label>
                  <label>
                    <input type="radio" name={name} checked={a.mode === "other"} onChange={() => set(q.n, { mode: "other" })} />
                    {t("questions.other")}
                  </label>
                  <label>
                    <input type="radio" name={name} checked={a.mode === "skip"} onChange={() => set(q.n, { mode: "skip" })} />
                    {t("questions.skip")}
                  </label>
                </div>
              )}
              {a.mode === "other" && (
                <textarea
                  aria-label={t("questions.answerLabel", { n: q.n })}
                  placeholder={t("questions.answerPlaceholder")}
                  rows={1}
                  value={a.text}
                  onChange={(e) => set(q.n, { text: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
