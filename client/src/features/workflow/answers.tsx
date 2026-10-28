import type { Question } from "@server/api-types";
import { ChatText } from "@phosphor-icons/react";
import { useEffect, useId } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** The answer to one question: its proposal, an own answer, or none yet. */
export interface Answer {
  mode: "proposal" | "other" | "skip";
  text: string;
}
export type Answers = Record<string, Answer>;

/** Questions with a proposal start on it: agreeing is the common case, one click less. */
export function initialAnswers(questions: Question[]): Answers {
  return Object.fromEntries(questions.map((q) => [String(q.n), { mode: q.proposal ? "proposal" : "other", text: "" }]));
}

/** The answers as one text for the agent ("1. <question>\n   → <answer>"); unanswered questions are left out. */
export function composeAnswers(questions: Question[], answers: Answers, agree: string): string {
  return questions
    .flatMap((q) => {
      const a = answers[String(q.n)];
      const reply = a?.mode === "proposal" && q.proposal ? `${agree}: ${q.proposal}` : a?.mode === "other" ? a.text.trim() : "";
      return reply ? [`${q.n}. ${q.text}\n   → ${reply.replace(/\n/g, "\n     ")}`] : [];
    })
    .join("\n");
}

/** One field per question the agent asked: take its proposal or write another answer. */
export function QuestionFields({ questions, control, agent, disabled }: { questions: Question[]; control: Control<{ answers: Answers }>; agent: string; disabled?: boolean }) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const answers = useWatch({ control, name: "answers" });
  return (
    <fieldset disabled={disabled} className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{t("questions.title", { count: questions.length, agent })}</legend>
      <ol className="grid gap-3">
        {questions.map((q) => {
          const key = String(q.n);
          return (
            <li key={q.n} className="grid gap-2 rounded-sm border border-line bg-surface p-3">
              <p className="text-sm">
                <span className="font-mono text-faint">{q.n}.</span> {q.text}
              </p>
              {q.proposal && (
                <Controller
                  control={control}
                  name={`answers.${key}.mode`}
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} aria-label={t("questions.choices", { n: q.n })}>
                      {(["proposal", "other", "skip"] as const).map((mode) => (
                        <div key={mode} className="flex items-start gap-2">
                          <RadioGroupItem value={mode} id={`${id}-${key}-${mode}`} className="mt-0.5" />
                          <Label htmlFor={`${id}-${key}-${mode}`} className="font-normal">
                            {mode === "proposal" ? (
                              <>
                                {t("questions.agree")}: <strong>{q.proposal}</strong>
                              </>
                            ) : (
                              t(`questions.${mode}`)
                            )}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}
                />
              )}
              {answers?.[key]?.mode === "other" && (
                <Controller
                  control={control}
                  name={`answers.${key}.text`}
                  render={({ field }) => (
                    <Textarea {...field} rows={2} className="min-h-16" aria-label={t("questions.answerLabel", { n: q.n })} placeholder={t("questions.answerPlaceholder")} />
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}

/** Answers the agent from here: one field per question it asked, plus free text; sent into the session as it is. */
export function ReplyForm({ send, questions, agent, onSent }: { send: (text: string) => Promise<unknown>; questions: Question[]; agent: string; onSent: () => void }) {
  const { t } = useTranslation("workflow");
  const id = useId();
  const form = useForm<{ answers: Answers; text: string }>({ defaultValues: { answers: initialAnswers(questions), text: "" } });
  const asked = JSON.stringify(questions);
  // New questions start a new set of answers.
  useEffect(() => form.reset({ answers: initialAnswers(JSON.parse(asked) as Question[]), text: "" }), [asked, form]);
  const values = useWatch({ control: form.control });
  const reply = [composeAnswers(questions, (values.answers ?? {}) as Answers, t("questions.agree")), (values.text ?? "").trim()].filter(Boolean).join("\n\n");
  const error = form.formState.errors.root?.message;

  const submit = form.handleSubmit(async () => {
    try {
      await send(reply);
      form.setValue("text", "");
      onSent();
    } catch (e) {
      form.setError("root", { message: (e as Error).message });
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-3">
      {questions.length > 0 && (
        <QuestionFields questions={questions} control={form.control as unknown as Control<{ answers: Answers }>} agent={agent} disabled={form.formState.isSubmitting} />
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-text`}>{questions.length > 0 ? t("now.replyMore") : t("now.replyLabel", { agent })}</Label>
        <Textarea id={`${id}-text`} rows={2} className="min-h-16" placeholder={t("now.replyPlaceholder")} aria-describedby={error ? `${id}-error` : undefined} {...form.register("text")} />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="attention" busy={form.formState.isSubmitting} disabled={!reply}>
          <ChatText aria-hidden />
          {t("now.replySend")}
        </Button>
      </div>
    </form>
  );
}
