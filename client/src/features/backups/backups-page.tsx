import type { BackupDiff, BackupView } from "@server/api-types";
import { ArrowCounterClockwise, FilePlus } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DiffView } from "@/components/diff-view";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { call } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { useRepo } from "@/features/workspace/queries";

const ALL = "*";

const backupsApi = {
  list: () => call<BackupView[]>("GET", "/api/backups"),
  diff: (id: string) => call<BackupDiff>("GET", `/api/backups/${encodeURIComponent(id)}/diff`),
  restore: (id: string) => call<unknown>("POST", `/api/backups/${encodeURIComponent(id)}/restore`),
};

/** Copies TaskPilot took before each config write: what restoring one would change, and the restore. */
export function BackupsPage() {
  const { t, i18n } = useTranslation(["config", "common"]);
  const repo = useRepo().data?.path;
  const list = useQuery({ queryKey: ["backups", repo], queryFn: backupsApi.list, enabled: Boolean(repo) });
  const [file, setFile] = useState(ALL);
  const [picked, setPicked] = useState<string | null>(null);
  const backups = (list.data ?? []).filter((b) => file === ALL || b.display === file);
  const files = [...new Set((list.data ?? []).map((b) => b.display))].sort();
  const entry = backups.find((b) => b.id === picked) ?? backups.find((b) => b.restorable);
  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={t("backups.title")}
        subtitle={t("backups.subtitle")}
        actions={
          files.length > 1 && (
            <Select value={file} onValueChange={setFile}>
              <SelectTrigger className="w-auto min-w-48" aria-label={t("backups.filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("backups.all")}</SelectItem>
                {files.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />
      {list.error ? (
        <EmptyState title={list.error.message} />
      ) : !list.data ? (
        <p className="p-6 text-sm text-muted">{t("loading")}</p>
      ) : !list.data.length ? (
        <EmptyState title={t("backups.empty")}>{t("backups.emptyHint")}</EmptyState>
      ) : (
        <div className="grid gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="grid content-start gap-1" aria-label={t("backups.title")}>
            {backups.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  disabled={!b.restorable}
                  onClick={() => setPicked(b.id)}
                  aria-current={b.id === entry?.id ? "true" : undefined}
                  className={cn(
                    "grid w-full gap-0.5 rounded-sm px-2.5 py-2 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60",
                    b.id === entry?.id && "bg-signal-soft",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{b.display}</span>
                    {!b.restorable && <Badge>{t("backups.otherRepo")}</Badge>}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <time dateTime={new Date(b.at).toISOString()}>{time.format(b.at)}</time>
                    <span aria-hidden>·</span>
                    <span className="truncate">{b.reason}</span>
                  </span>
                  {!b.existed && (
                    <span className="flex items-center gap-1 text-xs text-faint">
                      <FilePlus aria-hidden />
                      {t("backups.created")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {entry ? <BackupDetail key={entry.id} entry={entry} when={time.format(entry.at)} /> : <EmptyState title={t("backups.pick")} />}
        </div>
      )}
    </div>
  );
}

function BackupDetail({ entry, when }: { entry: BackupView; when: string }) {
  const { t } = useTranslation(["config", "common"]);
  const diff = useQuery({ queryKey: ["backup-diff", entry.id], queryFn: () => backupsApi.diff(entry.id) });
  const [confirm, setConfirm] = useState(false);
  const restore = useMutation({
    mutationFn: () => backupsApi.restore(entry.id),
    onSuccess: async () => {
      toast.success(t("backups.restored", { file: entry.display }));
      setConfirm(false);
      await Promise.all(["backups", "backup-diff", "config", "raw", "workflow"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
    },
    onError: (e) => toast.error(e.message),
  });
  // A patch without a hunk: the file already has the backup's content.
  const same = diff.data !== undefined && !diff.data.diff.includes("\n@@");

  return (
    <section className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <code className="truncate bg-transparent px-0 text-sm">{entry.display}</code>
          <span className="text-xs text-muted">
            {when} · {entry.reason}
          </span>
        </div>
        <Button variant="primary" disabled={!diff.data || same} onClick={() => setConfirm(true)}>
          <ArrowCounterClockwise aria-hidden />
          {t("backups.restore")}
        </Button>
      </div>
      <p className="text-xs text-muted">{entry.existed ? t("backups.diffHint") : t("backups.restoreDeletes")}</p>
      {diff.error ? (
        <p role="alert" className="text-sm text-danger">
          {diff.error.message}
        </p>
      ) : !diff.data ? (
        <p className="text-sm text-muted">{t("loading")}</p>
      ) : same ? (
        <p className="text-sm text-muted">{t("backups.same")}</p>
      ) : (
        <DiffView diff={diff.data.diff} />
      )}

      <Dialog open={confirm} onOpenChange={(open) => !restore.isPending && setConfirm(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("backups.restoreTitle", { file: entry.display })}</DialogTitle>
            <DialogDescription>
              {!entry.existed && `${t("backups.restoreDeletes")} `}
              {t("backups.restoreConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common:cancel")}
            </Button>
            <Button variant="primary" busy={restore.isPending} onClick={() => restore.mutate()}>
              <ArrowCounterClockwise aria-hidden />
              {t("backups.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
