import {
  BookOpenText,
  Globe,
  ListChecks,
  MagnifyingGlass,
  PencilSimpleLine,
  Robot,
  TerminalWindow,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import type { ToolCategory } from "../../api/types";

const ICONS: Record<ToolCategory, Icon> = {
  read: BookOpenText,
  write: PencilSimpleLine,
  run: TerminalWindow,
  search: MagnifyingGlass,
  web: Globe,
  agent: Robot,
  plan: ListChecks,
  other: Wrench,
};

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  read: "Đọc",
  write: "Ghi",
  run: "Lệnh",
  search: "Tìm",
  web: "Web",
  agent: "Subagent",
  plan: "Kế hoạch",
  other: "Công cụ",
};

/** Colored icon for a tool category (decorative: the summary text says the same). */
export function CategoryIcon({ category = "other" }: { category?: ToolCategory }) {
  const Glyph = ICONS[category];
  return (
    <span className={`cat-icon cat-${category}`} aria-hidden="true">
      <Glyph weight="bold" />
    </span>
  );
}
