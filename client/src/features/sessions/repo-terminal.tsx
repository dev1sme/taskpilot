import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/lib/query-client";
import { REPO_SESSION_KEY, sessionsApi, useRepoSessions } from "./queries";
import { TerminalDrawer } from "./terminal-drawer";

/** An agent in the repo without a task, on every page; opens by itself when one of its sessions asks for permission. */
export function RepoTerminal({ open, onToggle }: { open: boolean; onToggle: (open: boolean) => void }) {
  const { t } = useTranslation("sessions");
  const sessions = useRepoSessions().data ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const asking = sessions.find((s) => s.activity === "permission")?.id;
  const [seenAsking, setSeenAsking] = useState<string | undefined | null>(null);
  if (seenAsking !== asking) {
    setSeenAsking(asking);
    if (asking) setActiveId(asking);
  }
  // Opening is the parent's state, so it stays out of render.
  useEffect(() => {
    if (asking) onToggle(true);
  }, [asking, onToggle]);
  if (!open) return null;
  return (
    <TerminalDrawer
      label={t("repoTerminal")}
      scope="repo"
      emptyHint={t("repoEmpty")}
      onCreate={sessionsApi.createRepo}
      sessions={sessions}
      activeId={activeId}
      open
      runSessionIds={[]}
      onSelect={setActiveId}
      onToggle={onToggle}
      onChanged={() => void queryClient.invalidateQueries({ queryKey: ["sessions", REPO_SESSION_KEY] })}
    />
  );
}
