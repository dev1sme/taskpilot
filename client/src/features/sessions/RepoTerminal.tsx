import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../workspace";
import { TerminalDrawer } from "./TerminalDrawer";
import { useRepoSessions } from "./useSessions";
import { sessionsApi } from "./api";

/**
 * An agent in the repo without a task, on every page. Rendered only while open; the footer's
 * Terminal button opens it. Opens by itself when a repo session asks for permission.
 */
export function RepoTerminal({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const { t } = useTranslation("sessions");
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
        label={t("repoTerminal")}
        scopeLabel="repo"
        emptyHint={t("repoEmpty")}
        onCreate={sessionsApi.createRepoSession}
        sessions={sessions}
        activeId={activeId}
        open
        runSessionIds={[]}
        onSelect={setActiveId}
        onToggle={onToggle}
        onChanged={() => void reload()}
      />
    </div>
  );
}
