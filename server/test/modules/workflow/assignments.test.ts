import { describe, expect, it } from "vitest";
import { overlaps, parseAssignments } from "../../../src/modules/workflow/assignments.js";

const plan = (table: string[], heading = "## 7. Phân công") => ["# T-1 — Kế hoạch", "", "## 6. Câu hỏi mở", "1. A?", "", heading, "", ...table, "", "## 8. Khác", ""].join("\n");

describe("assignment table", () => {
  it("reads the subtasks of the Phân công table", () => {
    const { items, errors } = parseAssignments(
      plan([
        "| # | Việc | Agent | File | Đầu ra | Phụ thuộc |",
        "|---|------|-------|------|--------|-----------|",
        "| 1 | Viết parser | claude | `server/a.ts`, server/b.ts | parser + test | - |",
        "| 2 | Làm UI | copilot | client/ | UI | 1 |",
        "| 3 | Docs | Claude | docs/ | docs | 1, 2 |",
      ]),
    );
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { n: 1, title: "Viết parser", agent: "claude", files: ["server/a.ts", "server/b.ts"], output: "parser + test", deps: [] },
      { n: 2, title: "Làm UI", agent: "copilot", files: ["client"], output: "UI", deps: [1] },
      { n: 3, title: "Docs", agent: "claude", files: ["docs"], output: "docs", deps: [1, 2] },
    ]);
  });

  it("finds columns by name in any order, and accepts — and empty cells as no dependency", () => {
    const { items, errors } = parseAssignments(
      plan(["| Agent | phụ thuộc | VIỆC | # |", "|---|---|---|---|", "| **Copilot** | — | Một | 1 |", "| claude |  | Hai | 2 |"]),
    );
    expect(errors).toEqual([]);
    expect(items.map((a) => [a.n, a.title, a.agent, a.deps, a.files, a.output])).toEqual([
      [1, "Một", "copilot", [], [], ""],
      [2, "Hai", "claude", [], [], ""],
    ]);
  });

  it("reports every problem of the table", () => {
    const { items, errors } = parseAssignments(
      plan([
        "| # | Việc | Agent | Phụ thuộc |",
        "|---|---|---|---|",
        "| 1 | A | gemini | 9 |",
        "| 1 | B | claude | - |",
        "| x | C | claude | - |",
        "| 2 | D | claude | 2 |",
      ]),
    );
    expect(items).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown agent "gemini"'),
        expect.stringContaining("duplicate number 1"),
        expect.stringContaining("# must be a positive integer"),
        expect.stringContaining('depends on "9"'),
        expect.stringContaining("depends on itself"),
      ]),
    );
  });

  it("rejects a dependency loop", () => {
    const { errors } = parseAssignments(
      plan(["| # | Việc | Agent | Phụ thuộc |", "|---|---|---|---|", "| 1 | A | claude | 3 |", "| 2 | B | claude | 1 |", "| 3 | C | claude | 2 |"]),
    );
    expect(errors).toEqual(["dependency loop: 1 → 3 → 2 → 1"]);
  });

  it("explains a missing column, an empty table and a missing section", () => {
    expect(parseAssignments(plan(["| # | Việc |", "|---|---|", "| 1 | A |"])).errors).toEqual(["missing column: agent"]);
    expect(parseAssignments(plan(["| # | Việc | Agent |", "|---|---|---|"])).errors).toEqual(["the assignment table has no rows"]);
    expect(parseAssignments("## 6. Câu hỏi mở\n\n| a | b |\n|---|---|\n| 1 | 2 |\n").errors[0]).toMatch(/no assignment table/);
  });

  it("ignores a table that sits under another heading", () => {
    const text = ["## 4. Rủi ro", "| # | Việc | Agent |", "|---|---|---|", "| 1 | A | claude |", "", "## 7. Phân công", "", "Chưa có."].join("\n");
    expect(parseAssignments(text).errors[0]).toMatch(/no assignment table/);
  });
});

describe("overlaps", () => {
  it("treats a directory as the prefix of its files", () => {
    expect(overlaps(["server/src"], ["server/src/a.ts"])).toBe(true);
    expect(overlaps(["./client/"], ["client"])).toBe(true);
    expect(overlaps(["server/src/**"], ["server/src/a.ts"])).toBe(true);
    expect(overlaps(["server/src"], ["server/srcx/a.ts"])).toBe(false);
    expect(overlaps(["a.ts"], ["b.ts"])).toBe(false);
    expect(overlaps([], ["b.ts"])).toBe(false);
  });
});
