/** A question Claude left for the reviewer, with the answer it proposes. */
export interface Question {
  /** The number Claude gave it. */
  n: number;
  text: string;
  proposal?: string;
}

const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
/** "**Câu hỏi còn chờ reviewer:**" stands for a heading in the decision log's skeleton. */
const BOLD_LINE = /^\s*\*\*(.+?)\*\*\s*$/;
const ABOUT_QUESTIONS = /câu hỏi|question/i;
/** "— Đề xuất: …", "- Đề xuất: …", "(Đề xuất: …)", "Proposal: …". */
const PROPOSAL = /\s*(?:[—–-]\s*|\(\s*)?(?:đề xuất|proposal)\s*:\s*(.+?)\)?\s*$/i;
const NONE = /^(không có|none)\.?$/i;

/**
 * The numbered questions under a heading about questions ("## 6. Câu hỏi mở") in a document or
 * Claude's message. A message without such a heading counts its last numbered list, but only items
 * that read as questions (a "?" or a proposal), so a numbered summary is not taken for questions.
 */
export function parseQuestions(markdown: string): Question[] {
  const lines = markdown.split("\n");
  const sections = sectionsAboutQuestions(lines);
  if (sections.length > 0) return sections.flatMap((s) => items(s)).filter((q) => !NONE.test(q.text));
  const blocks = numberedBlocks(lines);
  const last = blocks[blocks.length - 1] ?? [];
  const found = items(last);
  return found.every((q) => q.proposal !== undefined || q.text.includes("?")) ? found : [];
}

/** Lines under each heading (or bold line) about questions, up to the next heading of the same or a higher level. */
function sectionsAboutQuestions(lines: string[]): string[][] {
  const sections: string[][] = [];
  let current: { level: number; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    const bold = heading ? null : BOLD_LINE.exec(line);
    if (heading || bold) {
      const level = heading ? heading[1].length : 7;
      if (current && level <= current.level) current = null;
      if (!current && ABOUT_QUESTIONS.test(heading ? heading[2] : bold![1])) {
        current = { level, lines: [] };
        sections.push(current.lines);
        continue;
      }
    }
    current?.lines.push(line);
  }
  return sections;
}

/** Runs of numbered items, each item with its indented continuation lines. */
function numberedBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    if (NUMBERED.test(line)) (block ??= blocks[blocks.push([]) - 1]).push(line);
    else if (block && /^\s+\S/.test(line)) block.push(line);
    else if (line.trim() !== "") block = null;
  }
  return blocks;
}

function items(lines: string[]): Question[] {
  const found: Question[] = [];
  for (const line of lines) {
    const m = NUMBERED.exec(line);
    if (m) found.push({ n: Number(m[1]), text: m[2] });
    else if (found.length && /^\s+\S/.test(line)) found[found.length - 1].text += ` ${line.trim()}`;
  }
  return found.map(({ n, text }) => {
    const plain = text.replace(/\*\*/g, "").trim();
    const p = PROPOSAL.exec(plain);
    return p ? { n, text: plain.slice(0, p.index).trim(), proposal: p[1].trim() } : { n, text: plain };
  });
}
