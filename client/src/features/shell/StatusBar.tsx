import { HandPalm, SignOut, TerminalWindow } from "@phosphor-icons/react";
import { href } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { logout, useAuthMode } from "../auth/AuthGate";
import { useRepoSessions } from "../sessions/useSessions";
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
