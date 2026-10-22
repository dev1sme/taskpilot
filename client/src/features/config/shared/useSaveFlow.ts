import { useState } from "react";
import type { Preview, SaveResult } from "./types";

/**
 * Review-then-save: `review()` asks the server for a diff and opens the dialog; the dialog's
 * confirm saves. Errors (409 conflict, validation) stay in the dialog.
 */
export function useSaveFlow(opts: { title: string; preview: () => Promise<Preview>; save: () => Promise<SaveResult>; onSaved: (result: SaveResult) => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const review = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    try {
      setPreview(await opts.preview());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await opts.save();
      setOpen(false);
      opts.onSaved(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    review,
    dialog: {
      open,
      title: opts.title,
      diff: preview?.diff ?? (error ? "" : null),
      changed: preview?.changed,
      stale: preview?.stale,
      busy,
      error,
      onConfirm: () => void confirm(),
      onClose: () => setOpen(false),
    },
  };
}
