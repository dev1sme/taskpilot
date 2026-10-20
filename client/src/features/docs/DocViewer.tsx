import { X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "../../shared/ui/Markdown";
import "./docs.css";
import { docsApi } from "./api";

/** Full document in a panel sliding in from the right. Esc or the backdrop closes it. */
export function DocViewer(props: { taskKey: string; path: string | null; version: number; onClose: () => void }) {
  const { taskKey, path, onClose } = props;
  const { t } = useTranslation(["docs", "common"]);
  const query = useQuery({
    queryKey: ["doc", taskKey, path, props.version],
    queryFn: () => docsApi.file(taskKey, path!),
    enabled: !!path,
  });
  const content = query.data?.content ?? null;
  const error = query.error ? (query.error as Error).message : null;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!path) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [path, onClose]);

  return (
    <AnimatePresence>
      {path && (
        <>
          <motion.div
            className="viewer-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
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
              <code id="viewer-title">{path}</code>
              <button ref={closeRef} type="button" className="viewer-close" onClick={onClose} aria-label={t("common:close")}>
                <X weight="bold" />
              </button>
            </header>
            <div className="viewer-body">
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : content === null ? (
                <p className="hint">{t("loading")}</p>
              ) : (
                <Markdown source={content} />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
