import { Lexer } from "marked";

export interface MarkdownHeading {
  level: number;
  text: string;
  /** 1-based line of the heading text (for a setext heading, the line above its underline). */
  line: number;
}

/**
 * Top-level headings of a markdown document, ATX and setext, skipping code blocks. Headings
 * inside lists, blockquotes or HTML blocks are not part of the outline.
 */
export function markdownHeadings(text: string, maxDepth = 6): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let line = 1;
  // The raw text of the top-level tokens adds up to the whole source (line endings normalized to \n).
  for (const token of Lexer.lex(text)) {
    if (token.type === "heading" && token.depth <= maxDepth) {
      headings.push({ level: token.depth, text: token.text.replace(/\s+/g, " ").trim(), line });
    }
    line += token.raw.split("\n").length - 1;
  }
  return headings;
}
