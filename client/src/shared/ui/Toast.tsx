import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import "./dialog.css";

interface ToastItem {
  id: number;
  text: string;
  error: boolean;
}

const EVENT = "taskpilot:toast";
let seq = 0;

/** Shows a short confirmation ("Đã lưu CLAUDE.md") at the bottom right. */
export function toast(text: string, opts: { error?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent<ToastItem>(EVENT, { detail: { id: ++seq, text, error: Boolean(opts.error) } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setItems((prev) => [...prev, item]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== item.id)), 4500);
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
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
