import { X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/markdown";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { workspaceApi } from "@/features/workspace/queries";

/** A side panel over the page; open while `title` is set. */
function Viewer({ title, onClose, children }: { title: string | null; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Sheet open={title !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="bg-surface">
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <SheetTitle className="min-w-0 flex-1 truncate font-mono text-sm">{title}</SheetTitle>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-sm text-muted hover:bg-hover hover:text-ink" aria-label={t("close")}>
            <X className="size-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** A task document rendered as Markdown. */
export function DocViewer({ taskKey, path, version, onClose }: { taskKey: string; path: string | null; version: number; onClose: () => void }) {
  const { t } = useTranslation("docs");
  const query = useQuery({ queryKey: ["doc", taskKey, path, version], queryFn: () => workspaceApi.file(taskKey, path!), enabled: path !== null });
  return (
    <Viewer title={path} onClose={onClose}>
      {query.error ? (
        <p role="alert" className="text-sm text-danger">
          {query.error.message}
        </p>
      ) : query.data ? (
        <Markdown source={query.data.content} />
      ) : (
        <p className="text-sm text-muted">{t("loading")}</p>
      )}
    </Viewer>
  );
}

/** Plain text exactly as it is (a prompt as sent), in the same panel. */
export function TextViewer({ title, text, onClose }: { title: string | null; text: string; onClose: () => void }) {
  return (
    <Viewer title={title} onClose={onClose}>
      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>
    </Viewer>
  );
}
