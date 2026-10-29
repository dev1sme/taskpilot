import type { WorkspaceDiff, WorkspaceView } from "@taskpilot/server/api-types";
import { GitBranch, GitMerge, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { locale } from "@/i18n";
import { refreshTask, useWorkspaces, workspaceApi } from "./queries";

const LISTED_FILES = 10;

/** The task's run worktrees: what each holds, and the integrate/remove actions only the user takes. */
export function WorkspacePanel({ taskKey }: { taskKey: string }) {
  const { t } = useTranslation("workflow");
  const workspaces = useWorkspaces(taskKey);
  const items = workspaces.data ?? [];
  if (!items.length) return null;
  return (
    <section aria-label={t("worktree.title")} className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <GitBranch aria-hidden />
        {t("worktree.title")}
      </h2>
      {items.map((workspace) => (
        <WorkspaceItem key={workspace.runId} taskKey={taskKey} workspace={workspace} />
      ))}
    </section>
  );
}

type Confirm = { kind: "commit" | "force"; files: string[]; message: string };

function WorkspaceItem({ taskKey, workspace }: { taskKey: string; workspace: WorkspaceView }) {
  const { t } = useTranslation("workflow");
  const [busy, setBusy] = useState<"integrate" | "remove" | "diff" | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const removed = workspace.removedAt !== undefined;
  const integrated = workspace.integration.status === "integrated";

  const act = async (kind: "integrate" | "remove", action: () => Promise<unknown>, askAgain: Confirm["kind"]) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      setConfirm(null);
    } catch (e) {
      // The worktree's own uncommitted files: list them and let the user decide. The repo's: only report.
      if (e instanceof ApiError && e.status === 409 && e.reason === "worktree" && e.files) setConfirm({ kind: askAgain, files: e.files, message: e.message });
      else setError((e as Error).message);
    } finally {
      setBusy(null);
      void refreshTask(taskKey);
    }
  };
  const integrate = (commit: boolean) => act("integrate", () => workspaceApi.integrate(taskKey, workspace.runId, commit), "commit");
  const remove = (force: boolean) => act("remove", () => workspaceApi.remove(taskKey, workspace.runId, force), "force");
  const loadDiff = async () => {
    setBusy("diff");
    setError(null);
    try {
      setDiff(await workspaceApi.diff(taskKey, workspace.runId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="grid gap-2 border-t border-line pt-3 text-sm first-of-type:border-t-0 first-of-type:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{workspace.branch}</span>
        <IntegrationBadge workspace={workspace} />
        {workspace.active && <Badge tone="signal">{t("worktree.active")}</Badge>}
        {removed && <Badge>{t("worktree.removed")}</Badge>}
        {workspace.missing && !removed && <Badge tone="danger">{t("worktree.missing")}</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">{t("worktree.path")}</dt>
        <dd className="truncate font-mono" title={workspace.path}>
          {workspace.path}
        </dd>
        <dt className="text-muted">{t("worktree.base")}</dt>
        <dd className="font-mono">
          {workspace.baseRev.slice(0, 12)}
          {workspace.baseBranch && ` (${workspace.baseBranch})`} · {new Date(workspace.createdAt).toLocaleString(locale())}
        </dd>
        {!removed && workspace.commits !== null && (
          <>
            <dt className="text-muted">{t("worktree.state")}</dt>
            <dd>{t("worktree.counts", { commits: workspace.commits, changes: workspace.changes?.length ?? 0 })}</dd>
          </>
        )}
      </dl>
      {workspace.dirtyBaseAccepted && <p className="text-xs text-muted">{t("worktree.dirtyAccepted", { count: workspace.dirtyBaseAccepted.length })}</p>}
      {workspace.integration.status === "failed" && workspace.integration.message && (
        <p role="alert" className="text-xs text-danger">
          {workspace.integration.message}
        </p>
      )}
      {workspace.diffStat && (
        <details>
          <summary className="text-xs text-signal-text">{t("worktree.diffStat")}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-sm bg-bg p-2 font-mono text-xs whitespace-pre">{workspace.diffStat}</pre>
        </details>
      )}
      {diff && (
        <details open>
          <summary className="text-xs text-signal-text">{t("worktree.diff")}</summary>
          <pre className="mt-1 max-h-96 overflow-auto rounded-sm bg-bg p-2 font-mono text-xs whitespace-pre">{diff.diff || t("worktree.noDiff")}</pre>
          {diff.truncated && <p className="text-xs text-muted">{t("worktree.truncated")}</p>}
        </details>
      )}
      {confirm && (
        <div role="alert" className="grid gap-1.5 rounded-sm border border-attention-line bg-attention-soft p-2 text-xs">
          <p>{confirm.message}</p>
          <ul className="font-mono">
            {confirm.files.slice(0, LISTED_FILES).map((file) => (
              <li key={file}>{file}</li>
            ))}
            {confirm.files.length > LISTED_FILES && <li>{t("worktree.moreFiles", { count: confirm.files.length - LISTED_FILES })}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            {confirm.kind === "commit" ? (
              <Button size="sm" variant="attention" busy={busy === "integrate"} onClick={() => void integrate(true)}>
                <GitMerge aria-hidden />
                {t("worktree.commitAndIntegrate")}
              </Button>
            ) : (
              <Button size="sm" variant="danger" busy={busy === "remove"} onClick={() => void remove(true)}>
                <Trash aria-hidden />
                {t("worktree.forceRemove")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              {t("worktree.keep")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!removed && (
        <div className="flex flex-wrap gap-2">
          {!workspace.missing && (
            <Button size="sm" variant="ghost" busy={busy === "diff"} onClick={() => void loadDiff()}>
              {t("worktree.showDiff")}
            </Button>
          )}
          {!integrated && !workspace.missing && (
            <Button size="sm" variant="primary" busy={busy === "integrate"} disabled={workspace.active || busy !== null} onClick={() => void integrate(false)}>
              <GitMerge aria-hidden />
              {t("worktree.integrate")}
            </Button>
          )}
          <Button size="sm" variant="ghost" busy={busy === "remove"} disabled={workspace.active || busy !== null} onClick={() => void remove(false)}>
            <Trash aria-hidden />
            {t("worktree.remove")}
          </Button>
        </div>
      )}
      {workspace.active && !removed && <p className="text-xs text-muted">{t("worktree.activeHint")}</p>}
    </article>
  );
}

function IntegrationBadge({ workspace }: { workspace: WorkspaceView }) {
  const { t } = useTranslation("workflow");
  const status = workspace.integration.status;
  return <Badge tone={status === "integrated" ? "done" : status === "failed" ? "danger" : "neutral"}>{t(`worktree.integration.${status}`)}</Badge>;
}
