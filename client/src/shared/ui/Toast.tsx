import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import "./dialog.css";

/** A link at the end of a toast, e.g. to the page where the old version can be restored. */
export interface ToastAction {
  label: string;
  href: string;
}

interface ToastItem {
  id: number;
  text: string;
  error: boolean;
  action?: ToastAction;
}

const EVENT = "taskpilot:toast";
let seq = 0;

/** Shows a short confirmation ("Đã lưu CLAUDE.md") at the bottom right. */
export function toast(text: string, opts: { error?: boolean; action?: ToastAction } = {}): void {
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail: { id: ++seq, text, error: Boolean(opts.error), action: opts.action } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev, item]);
      // A toast with a link stays longer, so there is time to reach it.
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), item.action ? 8000 : 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className={`toast${t.error ? " is-error" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24 }}
          >
            {t.error ? <WarningCircle weight="fill" aria-hidden="true" /> : <CheckCircle weight="fill" aria-hidden="true" />}
            <span>{t.text}</span>
            {t.action && (
              <a className="toast-action" href={t.action.href}>
                {t.action.label}
              </a>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
