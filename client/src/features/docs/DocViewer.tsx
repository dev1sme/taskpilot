import { X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "../../shared/ui/Markdown";
import "./docs.css";
import { workspaceApi } from "../workspace";

/** Full document in a panel sliding in from the right. Esc or the backdrop closes it. */
export function DocViewer(props: { taskKey: string; path: string | null; version: number; onClose: () => void }) {
  const { taskKey, path } = props;
  const { t } = useTranslation("docs");
  const query = useQuery({
    queryKey: ["doc", taskKey, path, props.version],
    queryFn: () => workspaceApi.file(taskKey, path!),
    enabled: !!path,
  });
  const content = query.data?.content ?? null;
  const error = query.error ? (query.error as Error).message : null;

  return (
    <Viewer title={path} onClose={props.onClose}>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : content === null ? (
        <p className="hint">{t("loading")}</p>
      ) : (
        <Markdown source={content} />
      )}
    </Viewer>
  );
}

/** Plain text exactly as it is (e.g. a prompt as sent), in the same panel. */
export function TextViewer(props: { title: string | null; text: string; onClose: () => void }) {
  return (
    <Viewer title={props.title} onClose={props.onClose}>
      <pre className="viewer-text">{props.text}</pre>
    </Viewer>
  );
}

/** The sliding panel; open while `title` is set. */
function Viewer(props: { title: string | null; onClose: () => void; children: ReactNode }) {
  const { title, onClose } = props;
  const { t } = useTranslation("common");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!title) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [title, onClose]);

  return (
    <AnimatePresence>
      {title && (
        <>
          <motion.div className="viewer-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="viewer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="viewer-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
          >
            <header className="viewer-head">
              <code id="viewer-title">{title}</code>
              <button ref={closeRef} type="button" className="viewer-close" onClick={onClose} aria-label={t("close")}>
                <X weight="bold" />
              </button>
            </header>
            <div className="viewer-body">{props.children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
