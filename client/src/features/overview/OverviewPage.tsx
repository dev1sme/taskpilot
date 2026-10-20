import { ArrowRight, BookOpenText, CheckCircle, Command, Lightning, Plugs, Robot, ShieldCheck, Sparkle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { Trans, useTranslation } from "react-i18next";
import { href } from "../../shared/router";
import { useWorkspace, type TaskSummary } from "../workspace";
import { Elapsed } from "../../shared/ui/Elapsed";
import { CategoryIcon, useActivity, type ActivityItem } from "../activity";
import { PageHeader } from "../../shared/ui/PageHeader";
import { isAttention, sortTasks, statusOf } from "../tasks";
import "./overview.css";
import "./hero.css";
import "./running.css";
import "./inventory.css";
// Last: the narrow-screen rules override the tiles above.
import "./responsive.css";

/** Repo dashboard: what needs the user, what is running, and the shape of the Claude config. */
export function OverviewPage() {
  const { t } = useTranslation(["overview", "shell", "config", "common"]);
  const { repo, tasks, inventory } = useWorkspace();
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
        subtitle={repo?.path ? <span className="mono path-line" title={repo.path}>{repo.path}</span> : t("common:noRepo")}
      />

      <div className="bento" aria-label={t("label", { repo: repoName })}>
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
                {needs.map((task, i) => {
                  const s = statusOf(task);
                  return (
                    <motion.li
                      key={task.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i + 0.1 }}
                    >
                      <span className="need-glyph" aria-hidden="true">
                        {s.glyph}
                      </span>
                      <span className="need-text">
                        <span className="need-title">
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
        <section className="tile" aria-labelledby="tasks-title">
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
          <p className="tile-note">
            {t("tasks.counts", counts)}
          </p>
        </section>

        {/* CLAUDE.md */}
        <section className="tile" aria-labelledby="mem-title">
          <h2 id="mem-title" className="tile-title">
            <BookOpenText aria-hidden="true" /> {t("shell:nav.memory")}
          </h2>
          {inventory?.claudeMd.exists ? (
            <>
              <p className="tile-mono">
                {t("memory.size", { lines: inventory.claudeMd.lines, tokens: formatTokens(inventory.claudeMd.bytes / 4) })}
              </p>
              <div className="chips">
                {inventory.claudeMd.headings.slice(0, 3).map((h) => (
                  <span key={h} className="chip">
                    {h}
                  </span>
                ))}
                {inventory.claudeMd.headings.length > 3 && <span className="chip">+{inventory.claudeMd.headings.length - 3}</span>}
              </div>
            </>
          ) : (
            <p className="tile-note">{t("memory.missing")}</p>
          )}
          <a className="tile-link" href={href({ page: "config", section: "memory" })}>
            {t("memory.open")} <ArrowRight aria-hidden="true" />
          </a>
        </section>

        {/* MCP */}
        <section className="tile tile-wide" aria-labelledby="mcp-title">
          <div className="tile-head">
            <h2 id="mcp-title" className="tile-title">
              <Plugs aria-hidden="true" /> {t("shell:nav.mcp")}
            </h2>
            <span className="tile-mono">{t("config:mcp.tab.project")}</span>
          </div>
          {inventory?.mcp.error && (
            <p className="error" role="alert">
              {inventory.mcp.error}
            </p>
          )}
          {inventory?.mcp.servers.length ? (
            <ul className="rows">
              {inventory.mcp.servers.map((s) => (
                <li key={s.name}>
                  <span className="mono">{s.name}</span>
                  <span className="row-meta">{s.type}</span>
                </li>
              ))}
            </ul>
          ) : (
            !inventory?.mcp.error && <p className="tile-note">{t("mcp.empty")}</p>
          )}
          <a className="tile-link" href={href({ page: "config", section: "mcp" })}>
            {t("mcp.manage")} <ArrowRight aria-hidden="true" />
          </a>
        </section>

        {/* .claude */}
        <section className="tile tile-wide" aria-labelledby="dir-title">
          <h2 id="dir-title" className="tile-title">
            {t("dir.title")}
          </h2>
          <div className="inventory">
            <InvLink icon={Robot} n={inventory?.claudeDir.agents} label={t("shell:nav.agents")} section="agents" />
            <InvLink icon={Command} n={inventory?.claudeDir.commands} label={t("shell:nav.commands")} section="commands" />
            <InvLink icon={Sparkle} n={inventory?.claudeDir.skills} label={t("shell:nav.skills")} section="skills" />
            <InvLink icon={Lightning} n={inventory?.claudeDir.hooks} label={t("shell:nav.hooks")} section="hooks" />
          </div>
          <a className="tile-link" href={href({ page: "config", section: "settings" })}>
            <ShieldCheck aria-hidden="true" /> {t("dir.permissions", { allow: inventory?.claudeDir.allow ?? 0, deny: inventory?.claudeDir.deny ?? 0 })}
          </a>
        </section>
      </div>
    </div>
  );
}

function InvLink(props: {
  icon: typeof Robot;
  n: number | undefined;
  label: string;
  section: "agents" | "commands" | "skills" | "hooks";
}) {
  return (
    <a className="inv" href={href({ page: "config", section: props.section })}>
      <props.icon aria-hidden="true" />
      <span className="inv-n">{props.n ?? "–"}</span>
      <span className="inv-label">{props.label}</span>
    </a>
  );
}

/** The first running task, live: current tool, step timer, and a pulse of recent activity. */
function RunningTile({ tasks }: { tasks: TaskSummary[] }) {
  const { t } = useTranslation("overview");
  const first = tasks[0];
  return (
    <section className={`tile tile-wide tile-running${first ? " is-live" : ""}`} aria-labelledby="run-title">
      {first ? <Live task={first} others={tasks.length - 1} /> : (
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
            {current.summary}
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
  const now = Date.now();
  const buckets = new Array<number>(24).fill(0);
  for (const i of items) {
    if (i.kind !== "tool") continue;
    const b = 23 - Math.floor((now - i.at) / 30_000);
    if (b >= 0 && b < 24) buckets[b]++;
  }
  const max = Math.max(1, ...buckets);
  return (
    <div className="pulse" role="img" aria-label={t("running.pulse", { count: buckets.reduce((a, b) => a + b, 0) })}>
      {buckets.map((n, i) => (
        <motion.span
          key={i}
          initial={false}
          animate={{ height: `${Math.max(6, (n / max) * 100)}%` }}
          transition={{ duration: 0.4 }}
          className={n > 0 ? "is-on" : undefined}
        />
      ))}
    </div>
  );
}

/** Rough size for a prompt file (about 4 bytes per token). */
function formatTokens(n: number): string {
  return n < 1000 ? String(Math.round(n / 10) * 10) : `${(n / 1000).toFixed(1)}k`;
}
