import { FloppyDisk, Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import "./dialog.css";

/** Unified diff review before a save. Lines are colored; the file header lines are dropped. */
export function DiffDialog(props: {
  open: boolean;
  title: string;
  diff: string | null;
  changed?: boolean;
  stale?: boolean;
  busy?: boolean;
  error?: string | null;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const lines = (props.diff ?? "").split("\n").filter((l) => !/^(={3,}|-{3} |\+{3} |Index: |\\ No newline)/.test(l));
  const added = lines.filter((l) => l.startsWith("+")).length;
  const removed = lines.filter((l) => l.startsWith("-")).length;

  return (
    <AnimatePresence>
      {props.open && (
        <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="diff-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="dialog-head">
              <div>
                <h2 id="diff-title">{props.title}</h2>
                <p className="dialog-sub">
                  <span className="diff-add">+{added}</span> <span className="diff-del">−{removed}</span> dòng · bản cũ được
                  backup trước khi ghi
                </p>
              </div>
              <button ref={closeRef} type="button" className="icon-btn" onClick={props.onClose} aria-label="Đóng">
                <X weight="bold" />
              </button>
            </header>

            {props.stale && (
              <p className="alert-warn" role="alert">
                <Warning weight="fill" aria-hidden="true" />
                <span>File đã bị sửa bên ngoài TaskPilot sau khi ba mở. Lưu sẽ bị từ chối; hãy tải lại bản mới nhất.</span>
              </p>
            )}
            {props.error && (
              <p className="error" role="alert">
                {props.error}
              </p>
            )}

            {props.diff === null ? (
              <p className="hint">Đang tạo diff…</p>
            ) : props.changed === false ? (
              <p className="hint">Không có thay đổi nào so với file hiện tại.</p>
            ) : (
              <pre className="diff-view" aria-label="Thay đổi">
                {lines.map((l, i) => (
                  <span
                    key={i}
                    className={l.startsWith("+") ? "is-add" : l.startsWith("-") ? "is-del" : l.startsWith("@@") ? "is-hunk" : undefined}
                  >
                    {l || " "}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}

            <footer className="dialog-actions">
              <Button variant="quiet" onClick={props.onClose}>
                Tiếp tục sửa
              </Button>
              <Button
                icon={FloppyDisk}
                variant="primary"
                busy={props.busy}
                disabled={props.diff === null || props.changed === false || props.stale}
                onClick={props.onConfirm}
              >
                {props.confirmLabel ?? "Lưu"}
              </Button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
