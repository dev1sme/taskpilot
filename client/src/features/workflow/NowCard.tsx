import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ChatCircleDots,
  CheckCircle,
  FileText,
  HandPalm,
  Play,
  PlugsConnected,
  TerminalWindow,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/Button";
import { Elapsed, formatDuration } from "../../shared/ui/Elapsed";
import { CategoryIcon, type ActivityItem } from "../activity";
import { workflowApi } from "./api";
import type { SessionView } from "../sessions";
import type { RunState, WorkflowStep } from "./types";

interface Props {
  taskKey: string;
  steps: WorkflowStep[];
  run: RunState | null;
  session: SessionView | null;
  activity: ActivityItem[];
  onOpenTerminal: () => void;
  onOpenDoc: (path: string) => void;
  onChanged: () => void;
}

/** What is happening right now and what the user can do about it. Gates use GateCard instead. */
export function NowCard(props: Props) {
  const { t } = useTranslation("workflow");
  const { run, session } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      props.onChanged();
    }
  };

  const retry = (
    <Button icon={ArrowClockwise} variant="attention" busy={busy} onClick={() => void act(() => workflowApi.retry(props.taskKey))}>
      {t("now.retry")}
    </Button>
  );
  const restart = (
    <Button icon={ArrowCounterClockwise} variant="quiet" busy={busy} onClick={() => void act(() => workflowApi.restartRun(props.taskKey))}>
      {t("now.restart")}
    </Button>
  );
  const openTerminal = (
    <Button icon={TerminalWindow} onClick={props.onOpenTerminal}>
      {t("now.openTerminal")}
    </Button>
  );
  const step = run ? props.steps[run.stepIndex] : undefined;
  const errorLine = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  // Not started, finished or cancelled: offer to (re)start.
  if (!run || run.phase === "done" || run.phase === "cancelled") {
    const done = run?.phase === "done";
    const lastDoc = [...props.steps].reverse().find((s) => s.doneFile)?.doneFile;
    return (
      <Card tone={done ? "done" : "idle"} icon={done ? <CheckCircle weight="fill" /> : <Play weight="fill" />}>
        <h3>{done ? t("now.doneTitle") : run ? t("now.cancelledTitle") : t("now.readyTitle")}</h3>
        <p className="now-text">
          {done ? (
            <Trans t={t} i18nKey="now.doneBody" values={{ duration: formatDuration(run.updatedAt - run.startedAt) }} components={{ strong: <strong /> }} />
          ) : (
            t("now.readyBody", { count: props.steps.length })
          )}
        </p>
        {errorLine}
        <div className="now-actions">
          {done && lastDoc && (
            <Button icon={FileText} variant="primary" size="lg" onClick={() => props.onOpenDoc(lastDoc)}>
              {t("now.readDoc", { file: lastDoc })}
            </Button>
          )}
          <Button
            icon={Play}
            variant={done ? "default" : "primary"}
            size={done ? "md" : "lg"}
            busy={busy}
            onClick={() => void act(() => (run ? workflowApi.restartRun(props.taskKey) : workflowApi.startRun(props.taskKey)))}
          >
            {run ? t("now.restart") : t("now.start")}
          </Button>
        </div>
      </Card>
    );
  }

  if (session?.activity === "permission") {
    const ask = [...props.activity].reverse().find((i) => i.kind === "permission");
    return (
      <Card tone="attention" icon={<HandPalm weight="fill" />}>
        <h3>{t("now.permissionTitle")}</h3>
        <p className="now-text">{ask?.action ?? t("now.permissionFallback")}</p>
        <p className="now-sub">{t("now.permissionHint")}</p>
        <div className="now-actions">
          <Button icon={TerminalWindow} variant="attention" onClick={props.onOpenTerminal}>
            {t("now.permissionAnswer")}
          </Button>
        </div>
      </Card>
    );
  }

  if (run.phase === "waiting") {
    return (
      <Card tone="attention" icon={<ChatCircleDots weight="fill" />}>
        <h3>{t("now.waitingTitle")}</h3>
        <p className="now-text">{run.message}</p>
        {run.lastMessage && <blockquote className="now-quote">{lastParagraph(run.lastMessage)}</blockquote>}
        {errorLine}
        <div className="now-actions">
          {openTerminal}
          {retry}
        </div>
      </Card>
    );
  }

  if (run.phase === "interrupted") {
    return (
      <Card tone="attention" icon={<PlugsConnected weight="fill" />}>
        <h3>{t("now.interruptedTitle", { step: step?.title })}</h3>
        <p className="now-text">{run.message}</p>
        {errorLine}
        <div className="now-actions">
          {retry}
          {restart}
        </div>
      </Card>
    );
  }

  // starting / running
  const current = currentTool(props.activity, run.stepStartedAt);
  const counts = countSince(props.activity, run.stepStartedAt);
  return (
    <Card tone="signal" icon={<span className="radar" aria-hidden="true" />}>
      <div className="now-head">
        <h3>{run.phase === "starting" ? t("now.startingTitle") : t("now.runningTitle", { step: step?.title })}</h3>
        <span className="now-timer">
          <Elapsed since={run.phase === "starting" ? run.updatedAt : run.stepStartedAt} />
        </span>
      </div>
      <div className="now-live" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={current?.id ?? run.phase}
            className="now-text now-tool"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {current ? (
              <>
                <CategoryIcon category={current.category} />
                {current.summary}
              </>
            ) : run.phase === "starting" ? (
              t("now.startingHint")
            ) : (
              t("now.thinking")
            )}
          </motion.p>
        </AnimatePresence>
      </div>
      {run.phase === "running" && (
        <ul className="now-counts" aria-label={t("now.countsLabel")}>
          <li>
            <Trans t={t} i18nKey="now.counts.read" values={{ count: counts.read }} components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans t={t} i18nKey="now.counts.write" values={{ count: counts.write }} components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans t={t} i18nKey="now.counts.run" values={{ count: counts.run }} components={{ strong: <strong /> }} />
          </li>
          {counts.error > 0 && (
            <li className="now-count-error">
              <Trans t={t} i18nKey="now.counts.error" values={{ count: counts.error }} components={{ strong: <strong /> }} />
            </li>
          )}
        </ul>
      )}
      {errorLine}
      {run.phase === "starting" && <div className="now-actions">{openTerminal}{retry}</div>}
    </Card>
  );
}

function Card(props: { tone: "signal" | "attention" | "done" | "idle"; icon: ReactNode; children: ReactNode }) {
  const { t } = useTranslation("workflow");
  return (
    <motion.section
      className={`now-card tone-${props.tone}`}
      aria-label={t("now.label")}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="now-icon" aria-hidden="true">
        {props.icon}
      </div>
      <div className="now-body">{props.children}</div>
    </motion.section>
  );
}

function currentTool(items: ActivityItem[], since: number): ActivityItem | undefined {
  const recent = items.filter((i) => i.at >= since - 1000 && i.kind === "tool");
  return [...recent].reverse().find((i) => i.status === "running") ?? recent[recent.length - 1];
}

function countSince(items: ActivityItem[], since: number) {
  const c = { read: 0, write: 0, run: 0, error: 0 };
  for (const i of items) {
    if (i.kind !== "tool" || i.at < since - 1000) continue;
    if (i.status === "error") c.error++;
    if (i.category === "read") c.read++;
    else if (i.category === "write") c.write++;
    else if (i.category === "run") c.run++;
  }
  return c;
}

function lastParagraph(text: string): string {
  const parts = text.trim().split(/\n\s*\n/);
  const last = parts[parts.length - 1] ?? "";
  return last.length > 400 ? `${last.slice(0, 400)}…` : last;
}
