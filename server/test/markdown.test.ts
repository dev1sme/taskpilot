import { describe, expect, it } from "vitest";
import { markdownHeadings } from "../src/markdown.js";

describe("markdownHeadings", () => {
  it("reads ATX and setext headings with their line numbers", () => {
    const text = ["# One ##", "", "Two", "===", "", "Three", "---", "", "#### Four", "##### Five"].join("\n");
    expect(markdownHeadings(text)).toEqual([
      { level: 1, text: "One", line: 1 },
      { level: 1, text: "Two", line: 3 },
      { level: 2, text: "Three", line: 6 },
      { level: 4, text: "Four", line: 9 },
      { level: 5, text: "Five", line: 10 },
    ]);
    expect(markdownHeadings(text, 4).map((h) => h.text)).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("skips code blocks, fenced with backticks or tildes", () => {
    const text = ["```sh", "## no", "```", "~~~", "## no", "~~~", "    ## indented code", "", "## Yes"].join("\n");
    expect(markdownHeadings(text)).toEqual([{ level: 2, text: "Yes", line: 9 }]);
  });

  it("keeps line numbers right across CRLF, link definitions and blank lines", () => {
    const text = ["[ref]: https://example.com", "[two]: https://example.org", "", "", "Para", "## After", "x"].join("\r\n");
    expect(markdownHeadings(text)).toEqual([{ level: 2, text: "After", line: 6 }]);
  });

  it("keeps inline markup and joins a multi-line setext heading", () => {
    expect(markdownHeadings("## Run `npm test` **now**\n\nfirst\nsecond\n===\n")).toEqual([
      { level: 2, text: "Run `npm test` **now**", line: 1 },
      { level: 1, text: "first second", line: 3 },
    ]);
  });
});
