import { Lexer, type Token, type Tokens } from "marked";
import { isProviderId } from "../../core/providers.js";
import { modelProblem } from "./models.js";
import type { Assignment } from "./types.js";

export interface ParsedAssignments {
  items: Assignment[];
  /** Why the table cannot be run, in English; empty when `items` is usable. */
  errors: string[];
}

/** Subtasks that may run at the same time, at most. */
export const MAX_PARALLEL = 4;

const ABOUT_ASSIGNMENTS = /phân công|assignment/i;
const NO_VALUE = /^[-—–]*$/;
/** A subagent name as Claude Code files it (`.claude/agents/<name>.md`): one word that cannot be read as another flag. */
const SUBAGENT_NAME = /^[A-Za-z0-9][\w.-]*$/;

type Column = "n" | "title" | "agent" | "subagent" | "model" | "files" | "output" | "deps";
const COLUMN_NAMES: Record<Column, string[]> = {
  n: ["#", "n", "số", "stt", "no"],
  title: ["việc", "task", "title", "tên việc"],
  agent: ["agent"],
  subagent: ["subagent", "sub-agent"],
  model: ["model"],
  files: ["file", "files", "file được sửa"],
  output: ["đầu ra", "output", "kết quả"],
  deps: ["phụ thuộc", "deps", "depends", "depends on", "dependencies"],
};
const REQUIRED: Column[] = ["n", "title", "agent"];

/**
 * The subtasks of the "Phân công" table of a plan: the first table under a heading about assignments.
 * Columns are found by their header names, in any order; every problem found is reported, not just the first.
 * `Subagent` and `Model` are optional, so a table written before they existed still runs.
 */
export function parseAssignments(markdown: string): ParsedAssignments {
  const table = findTable(markdown);
  if (!table) return fail("no assignment table: add a section 'Phân công' with a table | # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |");

  const at = new Map<Column, number>();
  table.header.forEach((cell, i) => {
    const name = plain(cell).toLowerCase();
    const column = (Object.keys(COLUMN_NAMES) as Column[]).find((c) => COLUMN_NAMES[c].includes(name));
    if (column && !at.has(column)) at.set(column, i);
  });
  const missing = REQUIRED.filter((c) => !at.has(c));
  if (missing.length > 0) return fail(`missing column: ${missing.map((c) => COLUMN_NAMES[c][0]).join(", ")}`);
  if (table.rows.length === 0) return fail("the assignment table has no rows");

  const errors: string[] = [];
  const items: Assignment[] = [];
  const cell = (row: string[], c: Column) => (at.has(c) ? (row[at.get(c)!] ?? "").trim() : "");
  const depsOf = new Map<Assignment, string>();
  for (const [i, row] of table.rows.entries()) {
    const where = `row ${i + 1}`;
    const raw = plain(cell(row, "n"));
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1) {
      errors.push(`${where}: # must be a positive integer, got "${raw}"`);
      continue;
    }
    if (items.some((a) => a.n === n)) errors.push(`${where}: duplicate number ${n}`);
    const title = cell(row, "title").replace(/\*\*/g, "").trim();
    if (!title) errors.push(`subtask ${n}: the title is empty`);
    const agent = plain(cell(row, "agent")).toLowerCase();
    if (!isProviderId(agent)) errors.push(`subtask ${n}: unknown agent "${plain(cell(row, "agent"))}"`);
    const subagent = word(cell(row, "subagent"));
    const hasSubagent = !NO_VALUE.test(subagent);
    if (hasSubagent && !SUBAGENT_NAME.test(subagent)) errors.push(`subtask ${n}: subagent "${subagent}" must be a name (one word, not starting with -)`);
    const model = word(cell(row, "model"));
    const hasModel = !NO_VALUE.test(model);
    const problem = hasModel && isProviderId(agent) ? modelProblem(agent, model) : null;
    if (problem) errors.push(`subtask ${n}: model "${model}" ${problem}`);
    const item: Assignment = {
      n,
      title,
      agent: isProviderId(agent) ? agent : "claude",
      ...(hasSubagent ? { subagent } : {}),
      ...(hasModel ? { model } : {}),
      files: list(cell(row, "files")),
      output: cell(row, "output").replace(/\*\*/g, "").trim(),
      deps: [],
    };
    depsOf.set(item, cell(row, "deps"));
    items.push(item);
  }

  for (const item of items) {
    const raw = plain(depsOf.get(item) ?? "");
    if (NO_VALUE.test(raw)) continue;
    for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
      const dep = Number(part.replace(/^(việc|#)/i, ""));
      if (!Number.isInteger(dep) || !items.some((a) => a.n === dep)) errors.push(`subtask ${item.n}: depends on "${part}", which is not a subtask`);
      else if (dep === item.n) errors.push(`subtask ${item.n}: depends on itself`);
      else if (!item.deps.includes(dep)) item.deps.push(dep);
    }
  }
  if (errors.length === 0) {
    const loop = findLoop(items);
    if (loop) errors.push(`dependency loop: ${loop.join(" → ")}`);
  }
  return { items: errors.length ? [] : items, errors };
}

/** Problems of a parsed table for a dispatch step that runs up to `parallel` subtasks at once. */
export function checkForParallel(items: Assignment[], parallel: number): string[] {
  if (parallel <= 1) return [];
  return items.filter((a) => a.files.length === 0).map((a) => `subtask ${a.n}: File is required when subtasks run in parallel`);
}

/** Problem when the table holds more subtasks than the dispatch step allows; nothing when there is no limit. */
export function checkSubtaskLimit(items: Assignment[], max: number | undefined): string[] {
  if (max === undefined || items.length <= max) return [];
  return [`the table has ${items.length} subtasks but dispatch.max-subtasks allows ${max}: merge subtasks or raise the limit`];
}

/** True when two lists of files or directories share a path: equal, or one inside the other. */
export function overlaps(a: string[], b: string[]): boolean {
  const left = a.map(normalize);
  const right = b.map(normalize);
  return left.some((x) => right.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}

function fail(error: string): ParsedAssignments {
  return { items: [], errors: [error] };
}

function findTable(markdown: string): { header: string[]; rows: string[][] } | null {
  let level = 0;
  for (const token of Lexer.lex(markdown) as Token[]) {
    if (token.type === "heading") {
      const depth = (token as Tokens.Heading).depth;
      if (level > 0 && depth <= level) level = 0;
      if (level === 0 && ABOUT_ASSIGNMENTS.test((token as Tokens.Heading).text)) level = depth;
    } else if (level > 0 && token.type === "table") {
      const t = token as Tokens.Table;
      return { header: t.header.map((h) => h.text), rows: t.rows.map((r) => r.map((c) => c.text)) };
    }
  }
  return null;
}

/** A cell without the markdown a model decorates it with: `agent`, **agent**. */
function plain(text: string): string {
  return text
    .replace(/[`*_]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}

/** A name cell (subagent, model) without its decoration; unlike `plain`, keeps `_`, which names may contain. */
function word(text: string): string {
  return text
    .replace(/`|\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}

function list(text: string): string[] {
  return text
    .split(/[,;\n]|<br\s*\/?>/i)
    .map((f) => normalize(plain(f)))
    .filter((f) => f && !NO_VALUE.test(f));
}

function normalize(file: string): string {
  return file
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/\*{1,2}$/, "")
    .replace(/\/+$/, "");
}

/** The numbers along a dependency loop, first one repeated at the end; null when there is none. */
function findLoop(items: Assignment[]): number[] | null {
  const deps = new Map(items.map((a) => [a.n, a.deps]));
  const state = new Map<number, "open" | "closed">();
  const walk = (n: number, trail: number[]): number[] | null => {
    if (state.get(n) === "closed") return null;
    if (state.get(n) === "open") return [...trail.slice(trail.indexOf(n)), n];
    state.set(n, "open");
    for (const dep of deps.get(n) ?? []) {
      const loop = walk(dep, [...trail, n]);
      if (loop) return loop;
    }
    state.set(n, "closed");
    return null;
  };
  for (const a of items) {
    const loop = walk(a.n, []);
    if (loop) return loop;
  }
  return null;
}
