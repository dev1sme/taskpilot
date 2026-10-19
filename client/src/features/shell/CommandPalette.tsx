import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, type Route } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import { sortTasks, statusOf } from "../tasks/taskStatus";
import "./shell.css";

interface Entry {
  id: string;
  label: string;
  hint: string;
  route: Route;
}

const PAGES: Entry[] = [
  { id: "p-overview", label: "Tổng quan", hint: "Trang", route: { page: "overview" } },
  { id: "p-tasks", label: "Task", hint: "Trang", route: { page: "tasks" } },
  { id: "p-memory", label: "CLAUDE.md", hint: "Cấu hình", route: { page: "config", section: "memory" } },
  { id: "p-settings", label: "Settings & quyền", hint: "Cấu hình", route: { page: "config", section: "settings" } },
  { id: "p-hooks", label: "Hooks", hint: "Cấu hình", route: { page: "config", section: "hooks" } },
  { id: "p-agents", label: "Agents", hint: "Cấu hình", route: { page: "config", section: "agents" } },
  { id: "p-commands", label: "Commands", hint: "Cấu hình", route: { page: "config", section: "commands" } },
  { id: "p-skills", label: "Skills", hint: "Cấu hình", route: { page: "config", section: "skills" } },
  { id: "p-mcp", label: "MCP servers", hint: "Tích hợp", route: { page: "config", section: "mcp" } },
];

/** ⌘K / Ctrl+K: jump to any task or page by typing. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tasks } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    const taskEntries: Entry[] = sortTasks(tasks).map((t) => ({
      id: `t-${t.key}`,
      label: t.title === t.key ? t.key : `${t.key} · ${t.title}`,
      hint: statusOf(t).label,
      route: { page: "task", key: t.key },
    }));
    const q = fold(query.trim());
    return [...taskEntries, ...PAGES].filter((e) => !q || fold(`${e.label} ${e.hint}`).includes(q)).slice(0, 12);
  }, [tasks, query]);

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
            aria-label="Tìm nhanh"
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
                placeholder="Tìm task hoặc trang"
                aria-label="Tìm task hoặc trang"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={entries[index]?.id}
              />
              <kbd>Esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" className="palette-list">
              {entries.length === 0 && <li className="palette-empty">Không có kết quả cho "{query}"</li>}
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
