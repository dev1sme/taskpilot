import { X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useWorkspace } from "../../app/workspace";
import { RepoPicker } from "./RepoPicker";

/** Switch repo: a small dialog around the path form. */
export function RepoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { repo, openRepo } = useWorkspace();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="repo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="repo-dialog-title"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="repo-dialog-head">
              <h2 id="repo-dialog-title">Mở repo</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng">
                <X weight="bold" />
              </button>
            </div>
            <p className="hint">Đường dẫn tới repo có thư mục .claude/tasks. TaskPilot nhớ repo này cho lần sau.</p>
            <RepoPicker
              repo={repo}
              autoFocus
              onChange={async (path) => {
                await openRepo(path);
                onClose();
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
