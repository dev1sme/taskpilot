import { Gauge, HandPalm, SignOut, TerminalWindow } from "@phosphor-icons/react";
import type { UsageView } from "../../api/types";
import { href } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { logout, useAuthMode } from "../auth/AuthGate";
import { useRepoSessions } from "../sessions/useSessions";
import { useUsage } from "./useUsage";
import "./shell.css";

/** Live, repo-wide counters at the bottom of every page. */
export function StatusBar(props: { terminalOpen: boolean; onToggleTerminal: (open: boolean) => void }) {
  const { repo, tasks, info } = useWorkspace();
  const { sessions: repoSessions } = useRepoSessions(repo?.path ?? null);
  const repoRunning = repoSessions.filter((s) => s.status === "running").length;
  const repoAsking = repoSessions.some((s) => s.activity === "permission");
  const running = tasks.reduce((n, t) => n + t.sessionsRunning, 0);
  const asking = tasks.filter((t) => t.waitingPermission);
  const mode = useAuthMode();
  const usage = useUsage();

  return (
    <footer className="status-bar">
      {repo?.path && (
        <button
          type="button"
          className={`status-item status-button status-terminal${repoAsking ? " is-warn" : ""}`}
          aria-expanded={props.terminalOpen}
          title="Claude trong repo, không cần task"
          onClick={() => props.onToggleTerminal(!props.terminalOpen)}
        >
          <TerminalWindow weight="bold" aria-hidden="true" />
          Terminal
          {repoRunning > 0 && <span className="status-count">{repoRunning}</span>}
          {repoAsking && (
            <>
              <HandPalm weight="fill" aria-hidden="true" />
              chờ quyền
            </>
          )}
        </button>
      )}
      <span className="status-item">
        <span className={`status-dot${running > 0 ? " is-live" : ""}`} aria-hidden="true" />
        {running} session đang chạy
      </span>
      {asking.length > 0 && (
        <a className="status-item is-warn" href={href({ page: "task", key: asking[0].key })}>
          <HandPalm weight="fill" aria-hidden="true" />
          {asking.length} xin quyền
        </a>
      )}
      {usage && <UsageItem usage={usage} />}
      <span className="status-item status-version">{info?.claudeVersion ? `claude ${info.claudeVersion}` : "không tìm thấy claude"}</span>
      {mode === "password" && (
        <button type="button" className="status-item status-button status-logout" onClick={() => void logout()}>
          <SignOut aria-hidden="true" />
          Đăng xuất
        </button>
      )}
    </footer>
  );
}

/** At or above this share of a window the item turns into a warning. */
const WARN_PERCENT = 80;

/** Claude plan usage as the last status line reported it: "5h 42% · 7d 18%". */
function UsageItem({ usage }: { usage: UsageView }) {
  const parts: string[] = [];
  const resets: string[] = [];
  if (usage.fiveHour) {
    parts.push(`5h ${Math.round(usage.fiveHour.usedPercentage)}%`);
    if (usage.fiveHour.resetsAt) resets.push(`5h reset lúc ${formatTime(usage.fiveHour.resetsAt, false)}`);
  }
  if (usage.sevenDay) {
    parts.push(`7d ${Math.round(usage.sevenDay.usedPercentage)}%`);
    if (usage.sevenDay.resetsAt) resets.push(`7d reset lúc ${formatTime(usage.sevenDay.resetsAt, true)}`);
  }
  if (usage.spend) parts.push(`spend ${Math.round(usage.spend.usedPercentage)}%`);
  const max = Math.max(usage.fiveHour?.usedPercentage ?? 0, usage.sevenDay?.usedPercentage ?? 0, usage.spend?.usedPercentage ?? 0);
  const title = ["Giới hạn gói Claude đã dùng (toàn tài khoản)", ...resets, `Cập nhật lúc ${formatTime(usage.updatedAt, true)}`].join("\n");

  return (
    <span className={`status-item status-usage${max >= WARN_PERCENT ? " is-warn" : ""}`} title={title}>
      <Gauge aria-hidden="true" />
      <span className="sr-only">Usage Claude: </span>
      {parts.join(" · ")}
    </span>
  );
}

function formatTime(ms: number, withDay: boolean): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return withDay ? `${time} ${d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}` : time;
}
