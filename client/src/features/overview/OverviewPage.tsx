import { ArrowRight, BookOpenText, CheckCircle, Command, Lightning, Plugs, Robot, ShieldCheck, Sparkle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { href } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import type { ActivityItem, TaskSummary } from "../../api/types";
import { Elapsed } from "../../components/Elapsed";
import { CategoryIcon } from "../activity/categories";
import { useActivity } from "../activity/useActivity";
import { PageHeader } from "../shell/PageHeader";
import { sortTasks, statusOf } from "../tasks/taskStatus";
import "./overview.css";

const CTA: Record<string, string> = {
  "Xin quyền": "Trả lời",
  "Chờ duyệt": "Xem & duyệt",
  "Chờ trả lời": "Trả lời Claude",
  "Gián đoạn": "Tiếp tục",
};

const DETAIL: Record<string, string> = {
  "Xin quyền": "Claude đang chờ ba cho phép một thao tác",
  "Chờ duyệt": "Một bước đã xong, chờ ba duyệt",
  "Chờ trả lời": "Claude dừng lại, có thể đang hỏi ba",
  "Gián đoạn": "Session dừng giữa chừng",
};

/** Repo dashboard: what needs the user, what is running, and the shape of the Claude config. */
export function OverviewPage() {
  const { repo, tasks, inventory } = useWorkspace();
  const sorted = sortTasks(tasks);
  const needs = sorted.filter((t) => statusOf(t).tone === "attention");
  const running = sorted.filter((t) => statusOf(t).tone === "active");
  const counts = { done: 0, active: 0, attention: 0, idle: 0 };
  for (const t of tasks) counts[statusOf(t).tone]++;
  const repoName = repo?.path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <div className="page">
      <PageHeader
        title="Tổng quan"
        subtitle={repo?.path ? <span className="mono path-line" title={repo.path}>{repo.path}</span> : "Chưa chọn repo"}
      />

      <div className="bento" aria-label={`Tổng quan ${repoName}`}>
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
                <h2 id="needs-title">việc đang chờ ba</h2>
              </div>
              <ul className="needs">
                {needs.map((t, i) => {
                  const s = statusOf(t);
                  return (
                    <motion.li
                      key={t.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i + 0.1 }}
                    >
                      <span className="need-glyph" aria-hidden="true">
                        {s.glyph}
                      </span>
                      <span className="need-text">
                        <span className="need-title">
                          <span className="mono">{t.key}</span>
                          {t.title !== t.key && ` · ${t.title}`}
                        </span>
                        <span className="need-sub">{DETAIL[s.label] ?? s.label}</span>
                      </span>
                      <a className="btn btn-attention" href={href({ page: "task", key: t.key })}>
                        <span>{CTA[s.label] ?? "Mở"}</span>
                      </a>
                    </motion.li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="hero-calm">
              <CheckCircle weight="fill" aria-hidden="true" />
              <h2 id="needs-title">Không có việc nào chờ ba</h2>
              <p>Khi Claude cần ba duyệt, trả lời hoặc cho phép, việc đó sẽ hiện ở đây đầu tiên.</p>
            </div>
          )}
        </motion.section>

        <RunningTile tasks={running} />

        {/* tasks */}
        <section className="tile" aria-labelledby="tasks-title">
          <h2 id="tasks-title" className="tile-title">
            Task
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
            {counts.done} xong · {counts.active} đang chạy · {counts.attention} chờ ba · {counts.idle} chưa chạy
          </p>
        </section>

        {/* CLAUDE.md */}
        <section className="tile" aria-labelledby="mem-title">
          <h2 id="mem-title" className="tile-title">
            <BookOpenText aria-hidden="true" /> CLAUDE.md
          </h2>
          {inventory?.claudeMd.exists ? (
            <>
              <p className="tile-mono">
                {inventory.claudeMd.lines} dòng · ~{formatTokens(inventory.claudeMd.bytes / 4)} token
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
            <p className="tile-note">Repo chưa có CLAUDE.md.</p>
          )}
          <a className="tile-link" href={href({ page: "config", section: "memory" })}>
            Mở CLAUDE.md <ArrowRight aria-hidden="true" />
          </a>
        </section>

        {/* MCP */}
        <section className="tile tile-wide" aria-labelledby="mcp-title">
          <div className="tile-head">
            <h2 id="mcp-title" className="tile-title">
              <Plugs aria-hidden="true" /> MCP servers
            </h2>
            <span className="tile-mono">.mcp.json</span>
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
            !inventory?.mcp.error && <p className="tile-note">Repo chưa khai báo MCP server nào trong .mcp.json.</p>
          )}
          <a className="tile-link" href={href({ page: "config", section: "mcp" })}>
            Quản lý MCP <ArrowRight aria-hidden="true" />
          </a>
        </section>

        {/* .claude */}
        <section className="tile tile-wide" aria-labelledby="dir-title">
          <h2 id="dir-title" className="tile-title">
            Thư mục .claude
          </h2>
          <div className="inventory">
            <InvLink icon={Robot} n={inventory?.claudeDir.agents} label="Agents" section="agents" />
            <InvLink icon={Command} n={inventory?.claudeDir.commands} label="Commands" section="commands" />
            <InvLink icon={Sparkle} n={inventory?.claudeDir.skills} label="Skills" section="skills" />
            <InvLink icon={Lightning} n={inventory?.claudeDir.hooks} label="Hooks" section="hooks" />
          </div>
          <a className="tile-link" href={href({ page: "config", section: "settings" })}>
            <ShieldCheck aria-hidden="true" /> {inventory?.claudeDir.allow ?? 0} quyền cho phép · {inventory?.claudeDir.deny ?? 0} bị chặn
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
  const first = tasks[0];
  return (
    <section className={`tile tile-wide tile-running${first ? " is-live" : ""}`} aria-labelledby="run-title">
      {first ? <Live task={first} others={tasks.length - 1} /> : (
        <>
          <h2 id="run-title" className="tile-title">
            Đang chạy
          </h2>
          <p className="tile-note">Không có task nào đang chạy. Mở một task và bấm "Bắt đầu quy trình".</p>
        </>
      )}
    </section>
  );
}

function Live({ task, others }: { task: TaskSummary; others: number }) {
  const items = useActivity(task.key);
  const current = [...items].reverse().find((i) => i.kind === "tool");
  return (
    <>
      <div className="tile-head">
        <span className="live-dot" aria-hidden="true" />
        <h2 id="run-title" className="tile-title">
          Đang chạy · <a href={href({ page: "task", key: task.key })} className="mono">{task.key}</a>
          {others > 0 && <span className="row-meta"> và {others} task khác</span>}
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
          "Claude đang khởi động…"
        )}
      </p>
      <Pulse items={items} />
    </>
  );
}

/** Tool calls per 30 s over the last 12 minutes. */
function Pulse({ items }: { items: ActivityItem[] }) {
  const now = Date.now();
  const buckets = new Array<number>(24).fill(0);
  for (const i of items) {
    if (i.kind !== "tool") continue;
    const b = 23 - Math.floor((now - i.at) / 30_000);
    if (b >= 0 && b < 24) buckets[b]++;
  }
  const max = Math.max(1, ...buckets);
  return (
    <div className="pulse" role="img" aria-label={`${buckets.reduce((a, b) => a + b, 0)} thao tác trong 12 phút qua`}>
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
