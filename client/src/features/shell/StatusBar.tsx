import { HandPalm, SignOut } from "@phosphor-icons/react";
import { href } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { logout, useAuthMode } from "../auth/AuthGate";
import "./shell.css";

/** Live, repo-wide counters at the bottom of every page. */
export function StatusBar() {
  const { tasks, info } = useWorkspace();
  const running = tasks.reduce((n, t) => n + t.sessionsRunning, 0);
  const asking = tasks.filter((t) => t.waitingPermission);
  const mode = useAuthMode();

  return (
    <footer className="status-bar">
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
        <button type="button" className="status-item status-logout" onClick={() => void logout()}>
          <SignOut aria-hidden="true" />
          Đăng xuất
        </button>
      )}
    </footer>
  );
}
