import type { ParsedAssignments, Question, RunState, RunView } from "@taskpilot/server/api-types";
import { ArrowsOut, ChatText, Check, Diamond } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AgentBadge } from "@/components/agent-badge";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRepo, workspaceApi } from "@/features/workspace/queries";
import { PROVIDER_LABELS } from "@taskpilot/shared";
import { composeAnswers, initialAnswers, QuestionFields, type Answers } from "./answers";
import { refreshTask, workflowApi } from "./queries";
import { AssignmentPreview } from "./subtasks";

type Step = RunView["workflow"]["steps"][number];

/**
 * The approval gate, front and center: the document the step produced next to the decision, the
 * agent's open questions with one answer each, then approve (short CTA, consequence below) or feedback.
 */
export function GateCard(props: {
  taskKey: string;
  run: RunState;
  step: Step;
  questions: Question[];
  assignments: ParsedAssignments | null;
  parallel: number;
  maxSubtasks?: number;
  isLast: boolean;
  docVersion: number;
  onOpenDoc: (path: string) => void;
}) {
  const { t } = useTranslation("workflow");
  const { taskKey, step } = props;
  const id = useId();
  const repo = useRepo().data?.path;
  const agent = PROVIDER_LABELS[step.effective.agent];
  const doc = useQuery({ queryKey: ["doc", taskKey, step.doneFile, props.docVersion, repo], queryFn: () => workspaceApi.file(taskKey, step.doneFile!), enabled: Boolean(step.doneFile) });
  const form = useForm<{ answers: Answers; feedback: string }>({ defaultValues: { answers: initialAnswers(props.questions), feedback: "" } });
  const asked = JSON.stringify(props.questions);
  // A revised document brings new questions: answers start again from their proposals.
  useEffect(() => form.reset({ answers: initialAnswers(JSON.parse(asked) as Question[]), feedback: "" }), [asked, form]);
  const values = useWatch({ control: form.control });
  const answered = composeAnswers(props.questions, (values.answers ?? {}) as Answers, t("questions.agree"));
  const feedbackText = [answered, (values.feedback ?? "").trim()].filter(Boolean).join("\n\n");
  const [busy, setBusy] = useState<"approve" | "feedback" | null>(null);
  const invalidPlan = (props.assignments?.errors.length ?? 0) > 0;

  const act = async (name: "approve" | "feedback", action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
      if (name === "feedback") form.setValue("feedback", "");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      void refreshTask(taskKey);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4 rounded-md border border-attention-line bg-attention-soft/40 p-4">
      <header className="flex items-start gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-sm bg-attention text-on-attention">
          <Diamond weight="fill" className="size-4" />
        </span>
        <div className="grid gap-1">
          <h2 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {t("gate.title")} <AgentBadge agent={step.effective.agent} />
          </h2>
          <p className="text-sm text-muted">
            <Trans t={t} i18nKey="gate.body" values={{ step: step.title }} components={{ strong: <strong className="text-ink" /> }} />
            {props.isLast ? t("gate.bodyLast") : t("gate.bodyNext")}
          </p>
          <p className="text-xs text-faint">{t("selection.effective", { agent, model: step.effective.model ?? t("selection.defaultModel") })}</p>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-3">
          {step.doneFile && (
            <div className="grid rounded-sm border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <code className="min-w-0 flex-1 truncate bg-transparent px-0">{step.doneFile}</code>
                <Button size="sm" variant="ghost" onClick={() => props.onOpenDoc(step.doneFile!)}>
                  <ArrowsOut aria-hidden />
                  {t("gate.readAll")}
                </Button>
              </div>
              {/* On phones the document opens in the side panel; the decision comes first. */}
              <div className="hidden max-h-[28rem] overflow-auto px-4 py-3 sm:block">
                {doc.data ? <Markdown source={doc.data.content} /> : <p className="text-sm text-muted">{t("gate.loading")}</p>}
              </div>
            </div>
          )}
          {props.run.lastMessage && (
            <details className="rounded-sm border border-line bg-surface">
              <summary className="flex min-h-9 items-center px-3 text-sm font-medium">{t("gate.summary", { agent })}</summary>
              <div className="border-t border-line px-4 py-3">
                <Markdown source={props.run.lastMessage} />
              </div>
            </details>
          )}
          {props.assignments && <AssignmentPreview assignments={props.assignments} parallel={props.parallel} maxSubtasks={props.maxSubtasks} />}
        </div>

        <form
          className="grid content-start gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act("feedback", () => workflowApi.feedback(taskKey, feedbackText));
          }}
        >
          {props.questions.length > 0 && (
            <QuestionFields questions={props.questions} control={form.control as unknown as Control<{ answers: Answers }>} agent={agent} disabled={busy !== null} />
          )}
          <div className="grid gap-1.5">
            <Button
              type="button"
              variant="attention"
              size="lg"
              busy={busy === "approve"}
              disabled={busy !== null || invalidPlan}
              onClick={() => void act("approve", () => workflowApi.approve(taskKey, answered))}
            >
              <Check weight="bold" aria-hidden />
              {props.isLast ? t("gate.approveLast") : t("gate.approveNext")}
            </Button>
            <p className="text-xs text-muted">
              {invalidPlan ? t("gate.assignmentsBlock") : props.isLast ? t("gate.consequenceLast") : t("gate.consequenceNext")}
              {answered && ` ${t("questions.approveHint")}`}
            </p>
          </div>
          <div className="grid gap-1.5 border-t border-line pt-3">
            <Label htmlFor={`${id}-feedback`}>{answered ? t("gate.feedbackLabelAnswered", { agent }) : t("gate.feedbackLabel", { agent })}</Label>
            <Textarea id={`${id}-feedback`} rows={2} className="min-h-16" placeholder={t("gate.feedbackPlaceholder")} {...form.register("feedback")} />
            <div>
              <Button type="submit" busy={busy === "feedback"} disabled={busy !== null || !feedbackText}>
                <ChatText aria-hidden />
                {t("gate.sendFeedback")}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
