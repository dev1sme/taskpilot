import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useWorkspace } from "../../app/workspace";
import { TerminalDrawer } from "./TerminalDrawer";
import { useRepoSessions } from "./useSessions";

/**
 * Claude in the repo without a task, on every page. Rendered only while open; the footer's
 * Terminal button opens it. Opens by itself when a repo session asks for permission.
 */
export function RepoTerminal({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const { repo } = useWorkspace();
  const { sessions, reload } = useRepoSessions(repo?.path ?? null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const asking = sessions.find((s) => s.activity === "permission")?.id;
  useEffect(() => {
    if (!asking) return;
    setActiveId(asking);
    onToggle(true);
  }, [asking, onToggle]);

  if (!open || !repo?.path) return null;
  return (
    <div className="repo-terminal">
      <TerminalDrawer
        label="Terminal repo"
        scopeLabel="repo"
        emptyHint="Chưa có session. Bấm + để mở Claude trong repo, không cần task."
        onCreate={api.createRepoSession}
        sessions={sessions}
        activeId={activeId}
        open
        runSessionId={null}
        onSelect={setActiveId}
        onToggle={onToggle}
        onChanged={() => void reload()}
      />
    </div>
  );
}
