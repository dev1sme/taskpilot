import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, type Route } from "../../shared/router";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { sortTasks, statusOf } from "../tasks/taskStatus";
import "./shell.css";

interface Entry {
  id: string;
  label: string;
  hint: string;
  route: Route;
}

/** Pages by their `shell:nav.*` and `shell:palette.hint.*` keys; translated when the palette renders. */
const PAGES = [
  { nav: "overview", hint: "page", route: { page: "overview" } },
  { nav: "tasks", hint: "page", route: { page: "tasks" } },
  { nav: "memory", hint: "config", route: { page: "config", section: "memory" } },
  { nav: "settings", hint: "config", route: { page: "config", section: "settings" } },
  { nav: "hooks", hint: "config", route: { page: "config", section: "hooks" } },
  { nav: "agents", hint: "config", route: { page: "config", section: "agents" } },
  { nav: "commands", hint: "config", route: { page: "config", section: "commands" } },
  { nav: "skills", hint: "config", route: { page: "config", section: "skills" } },
  { nav: "mcp", hint: "integrations", route: { page: "config", section: "mcp" } },
  { nav: "backups", hint: "backup", route: { page: "backups" } },
] as const satisfies ReadonlyArray<{ nav: string; hint: string; route: Route }>;

/** ⌘K / Ctrl+K: jump to any task or page by typing. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("shell");
  const { tasks } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    const taskEntries: Entry[] = sortTasks(tasks).map((task) => ({
      id: `t-${task.key}`,
      label: task.title === task.key ? task.key : `${task.key} · ${task.title}`,
      hint: statusOf(task).label,
      route: { page: "task", key: task.key },
    }));
    const pageEntries: Entry[] = PAGES.map((p) => ({ id: `p-${p.nav}`, label: t(`nav.${p.nav}`), hint: t(`palette.hint.${p.hint}`), route: p.route }));
    const q = fold(query.trim());
    return [...taskEntries, ...pageEntries].filter((e) => !q || fold(`${e.label} ${e.hint}`).includes(q)).slice(0, 12);
  }, [tasks, query, t]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => previous?.focus();
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  const go = (e: Entry | undefined) => {
    if (!e) return;
    navigate(e.route);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("palette.label")}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") go(entries[index]);
            }}
          >
            <div className="palette-input">
              <MagnifyingGlass aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("palette.placeholder")}
                aria-label={t("palette.placeholder")}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={entries[index]?.id}
              />
              <kbd>{t("palette.escape")}</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="palette-list">
              {entries.length === 0 && <li className="palette-empty">{t("palette.empty", { query })}</li>}
              {entries.map((e, i) => (
                <li
                  key={e.id}
                  id={e.id}
                  role="option"
                  aria-selected={i === index}
                  className="palette-item"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(e)}
                >
                  <span className="palette-label">{e.label}</span>
                  <span className="palette-hint">{e.hint}</span>
                  <ArrowRight className="palette-go" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Lowercase without Vietnamese diacritics, so "chờ duyệt" matches "cho duyet". */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
