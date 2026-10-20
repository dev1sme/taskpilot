import { describe, expect, it } from "vitest";
import { formatEntry } from "../../../src/modules/workflow/history.js";

describe("history entry", () => {
  it("formats a heading, a quote and a body", () => {
    const at = new Date(2026, 9, 20, 14, 3).getTime();
    expect(formatEntry({ at, step: "Implement", source: "Ba góp ý", quote: "a\nb", body: "c" })).toBe(
      "## 2026-10-20 14:03 · Implement · Ba góp ý\n\n> a\n> b\n\nc\n",
    );
  });
});
