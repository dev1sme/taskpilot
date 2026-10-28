import type { RawPreview } from "@taskpilot/server/api-types";
import { ArrowCounterClockwise, ArrowsClockwise, FloppyDisk, Trash, Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { DiffView } from "@/components/diff-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { rawApi, rawKey, type RawAddress } from "./queries";

/**
 * The file itself: edit, preview the diff (the server checks the syntax and whether the file
 * changed since it was read), then save with a backup. Library items can also be deleted.
 */
export function RawFileEditor({ address, onSaved }: { address: RawAddress; onSaved?: () => void }) {
  const { t } = useTranslation(["config", "common"]);
  const file = useQuery({ queryKey: rawKey(address), queryFn: () => rawApi.read(address) });
  const [draft, setDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState<RawPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (file.error) {
    return (
      <p role="alert" className="rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
        {file.error.message}
      </p>
    );
  }
  if (!file.data) return <p className="text-sm text-muted">{t("loading")}</p>;
  const data = file.data;
  const content = draft ?? data.content;
  const dirty = draft !== null && draft !== data.content;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: rawKey(address) });
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));

  const openPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await rawApi.preview(address, content, data.hash));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      await rawApi.save(address, content, data.hash);
      toast.success(t("raw.saved", { file: data.path }));
      setPreview(null);
      setDraft(null);
      await refresh();
      onSaved?.();
    } catch (e) {
      setPreview(null);
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await rawApi.remove(address, data.hash);
      toast.success(t("raw.deleted", { file: data.path }));
      setConfirmDelete(false);
      setDraft(null);
      await refresh();
      onSaved?.();
    } catch (e) {
      setConfirmDelete(false);
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-0 gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate bg-transparent px-0 text-sm">{data.path}</code>
        {dirty && <span className="text-xs text-attention">{t("raw.unsavedTitle")}</span>}
        <Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft(null)}>
          <ArrowCounterClockwise aria-hidden />
          {t("raw.revert")}
        </Button>
        {data.deletable && data.exists && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
            <Trash aria-hidden />
            {t("raw.delete")}
          </Button>
        )}
        <Button size="sm" variant="primary" busy={busy === "preview"} disabled={!dirty || busy !== null} onClick={() => void openPreview()}>
          <FloppyDisk aria-hidden />
          {t("raw.save")}
        </Button>
      </div>
      {!data.exists && <p className="text-xs text-muted">{t("raw.newFile")}</p>}
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Warning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("raw.secrets")}
      </p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-sm border border-danger/40 bg-danger-soft p-2.5 text-sm text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setError(null);
              void file.refetch();
            }}
          >
            <ArrowsClockwise aria-hidden />
            {t("raw.reload")}
          </Button>
        </div>
      )}
      <div className="h-[60vh] min-h-72 overflow-hidden rounded-sm border border-line">
        <CodeEditor value={content} onChange={setDraft} format={data.format} label={data.path} />
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && busy === null && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("raw.previewTitle", { file: data.path })}</DialogTitle>
            <DialogDescription>{t("raw.previewHint")}</DialogDescription>
          </DialogHeader>
          {preview?.stale && (
            <p role="alert" className="text-sm text-danger">
              {t("raw.stale")}
            </p>
          )}
          {preview && (preview.changed ? <DiffView diff={preview.diff} /> : <p className="text-sm text-muted">{t("raw.unchanged")}</p>)}
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setPreview(null)}>
              {t("common:cancel")}
            </Button>
            <Button variant="primary" busy={busy === "save"} disabled={!preview?.changed || preview.stale} onClick={() => void save()}>
              <FloppyDisk aria-hidden />
              {t("raw.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(open) => busy === null && setConfirmDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("raw.delete")}</DialogTitle>
            <DialogDescription>{t("raw.deleteConfirm", { file: data.path })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>
              {t("common:cancel")}
            </Button>
            <Button variant="danger" busy={busy === "delete"} onClick={() => void remove()}>
              <Trash aria-hidden />
              {t("raw.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
