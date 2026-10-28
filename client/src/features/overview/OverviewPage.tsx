import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Trans, useTranslation } from "react-i18next";
import { PROVIDER_IDS, PROVIDER_LABELS } from "../../shared/providers";
import { href } from "../../shared/router";
import { useWorkspace, type TaskSummary } from "../workspace";
import { Elapsed } from "../../shared/ui/Elapsed";
import { useNow } from "../../shared/useNow";
import { CategoryIcon, useActivity, type ActivityItem } from "../activity";
import { PageHeader } from "../../shared/ui/PageHeader";
import { isAttention, sortTasks, statusOf } from "../tasks";
import "./overview.css";
import "./hero.css";
import "./running.css";
import "./inventory.css";
// Last: the narrow-screen rules override the tiles above.
import "./responsive.css";

/** Waiting tasks listed in the hero; the rest are one click away on the task list. */
const NEEDS_SHOWN = 5;

/** Repo dashboard: what needs the user, what is running, and available coding providers. */
export function OverviewPage() {
  const { t } = useTranslation(["overview", "shell", "config", "common"]);
  const { repo, tasks, info } = useWorkspace();
  const sorted = sortTasks(tasks);
  const needs = sorted.filter((task) => statusOf(task).tone === "attention");
  const running = sorted.filter((task) => statusOf(task).tone === "active");
  const counts = { done: 0, active: 0, attention: 0, idle: 0 };
  for (const task of tasks) counts[statusOf(task).tone]++;
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <div className="page">
      <PageHeader
        title={t("title")}
        subtitle={
          repo?.path ? (
            <span className="mono path-line" title={repo.path}>
              {repo.path}
            </span>
          ) : (
            t("common:noRepo")
          )
        }
      />

      <div className="overview-layout" aria-label={t("label", { repo: repoName })}>
        <div className="overview-work">
          {/* needs you */}
          <motion.section
            className={`tile tile-hero${needs.length ? " has-needs" : ""}`}
            aria-labelledby="needs-title"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {needs.length > 0 ? (
              <>
                <div className="hero-count">
                  <span className="hero-number">{needs.length}</span>
                  <h2 id="needs-title">{t("needs.title")}</h2>
                </div>
                <ul className="needs">
                  {needs.slice(0, NEEDS_SHOWN).map((task, i) => {
                    const s = statusOf(task);
                    return (
                      <motion.li key={task.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i + 0.1 }}>
                        <span className="need-glyph" aria-hidden="true">
                          {s.glyph}
                        </span>
                        <span className="need-text">
                          <span className="need-title" title={task.title !== task.key ? `${task.key} · ${task.title}` : task.key}>
                            <span className="mono">{task.key}</span>
                            {task.title !== task.key && ` · ${task.title}`}
                          </span>
                          <span className="need-sub">{isAttention(s.kind) ? t(`needs.detail.${s.kind}`) : s.label}</span>
                        </span>
                        <a className="btn btn-attention" href={href({ page: "task", key: task.key })}>
                          <span>{isAttention(s.kind) ? t(`needs.cta.${s.kind}`) : t("needs.open")}</span>
                        </a>
                      </motion.li>
                    );
                  })}
                </ul>
                {needs.length > NEEDS_SHOWN && (
                  <a className="tile-link needs-all" href={href({ page: "tasks" })}>
                    {t("needs.all", { count: needs.length })} <ArrowRight aria-hidden="true" />
                  </a>
                )}
              </>
            ) : (
              <div className="hero-calm">
                <CheckCircle weight="fill" aria-hidden="true" />
                <h2 id="needs-title">{t("needs.calmTitle")}</h2>
                <p>{t("needs.calmBody")}</p>
              </div>
            )}
          </motion.section>

          <RunningTile tasks={running} />

          {/* tasks */}
          <section className="tile tile-summary" aria-labelledby="tasks-title">
            <h2 id="tasks-title" className="tile-title">
              {t("shell:nav.tasks")}
            </h2>
            <div className="big-number">{tasks.length}</div>
            {tasks.length > 0 && (
              <div className="stack-bar" aria-hidden="true">
                {counts.done > 0 && <span style={{ flex: counts.done, background: "var(--done)" }} />}
                {counts.active > 0 && <span style={{ flex: counts.active, background: "var(--signal)" }} />}
                {counts.attention > 0 && <span style={{ flex: counts.attention, background: "var(--attention)" }} />}
                {counts.idle > 0 && <span style={{ flex: counts.idle, background: "var(--line-strong)" }} />}
              </div>
            )}
            <p className="tile-note">{t("tasks.counts", counts)}</p>
          </section>
        </div>
        <section className="overview-providers" aria-labelledby="providers-title">
          <h2 id="providers-title" className="tile-title">
            {t("providers.title")}
          </h2>
          <div className="overview-config">
            {PROVIDER_IDS.map((provider) => {
              const version = info?.versions?.[provider] ?? (provider === "claude" ? info?.claudeVersion : undefined);
              const knownMissing = info !== null && (info.versions?.[provider] === null || (provider === "claude" && info.claudeVersion === null));
              return (
                <a className="provider-item" key={provider} href={href({ page: "config", section: "settings", cli: provider })}>
                  <span className={`provider-status${version ? " is-installed" : ""}`} aria-hidden="true" />
                  <span className="provider-identity">
                    <strong>{PROVIDER_LABELS[provider]}</strong>
                    <span className="tile-note">{version ? t("providers.installed") : knownMissing ? t("providers.missing") : t("providers.unknown")}</span>
                  </span>
                  {version && <span className="tile-mono provider-version">{version}</span>}
                  <ArrowRight className="provider-arrow" aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/** The first running task, live: current tool, step timer, and a pulse of recent activity. */
function RunningTile({ tasks }: { tasks: TaskSummary[] }) {
  const { t } = useTranslation("overview");
  const first = tasks[0];
  return (
    <section className={`tile tile-wide tile-running${first ? " is-live" : ""}`} aria-labelledby="run-title">
      {first ? (
        <Live task={first} others={tasks.length - 1} />
      ) : (
        <>
          <h2 id="run-title" className="tile-title">
            {t("running.title")}
          </h2>
          <p className="tile-note">{t("running.none")}</p>
        </>
      )}
    </section>
  );
}

function Live({ task, others }: { task: TaskSummary; others: number }) {
  const { t } = useTranslation("overview");
  const items = useActivity(task.key);
  const current = [...items].reverse().find((i) => i.kind === "tool");
  return (
    <>
      <div className="tile-head">
        <span className="live-dot" aria-hidden="true" />
        <h2 id="run-title" className="tile-title">
          <Trans t={t} i18nKey="running.live" values={{ task: task.key }} components={{ taskLink: <a href={href({ page: "task", key: task.key })} className="mono" /> }} />
          {others > 0 && <span className="row-meta">{t("running.others", { count: others })}</span>}
        </h2>
        {task.run?.stepStartedAt && (
          <span className="tile-timer">
            <Elapsed since={task.run.stepStartedAt} />
          </span>
        )}
      </div>
      <p className="live-tool" aria-live="polite">
        {current ? (
          <>
            <CategoryIcon category={current.category} />
            <span className="live-tool-text" title={current.summary}>
              {current.summary}
            </span>
          </>
        ) : (
          t("running.starting")
        )}
      </p>
      <Pulse items={items} />
    </>
  );
}

/** Tool calls per 30 s over the last 12 minutes. */
function Pulse({ items }: { items: ActivityItem[] }) {
  const { t } = useTranslation("overview");
  const now = useNow(1000);
  const buckets = new Array<number>(24).fill(0);
  for (const i of items) {
    if (i.kind !== "tool") continue;
    // An item newer than the last tick belongs in the last column.
    const b = Math.min(23, 23 - Math.floor((now - i.at) / 30_000));
    if (b >= 0) buckets[b]++;
  }
  const max = Math.max(1, ...buckets);
  return (
    <div className="pulse" role="img" aria-label={t("running.pulse", { count: buckets.reduce((a, b) => a + b, 0) })}>
      {buckets.map((n, i) => (
        <motion.span key={i} initial={false} animate={{ height: `${Math.max(6, (n / max) * 100)}%` }} transition={{ duration: 0.4 }} className={n > 0 ? "is-on" : undefined} />
      ))}
    </div>
  );
}
