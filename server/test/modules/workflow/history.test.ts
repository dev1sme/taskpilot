import { describe, expect, it } from "vitest";
import { formatEntry, HISTORY_TEXT } from "../../../src/modules/workflow/history.js";

describe("history entry", () => {
  it("formats a heading, a quote and a body", () => {
    const at = new Date(2026, 9, 20, 14, 3).getTime();
    expect(formatEntry({ at, step: "Implement", source: "Ba góp ý", quote: "a\nb", body: "c" })).toBe(
      "## 2026-10-20 14:03 · Implement · Ba góp ý\n\n> a\n> b\n\nc\n",
    );
  });

  it("names the subagent and model of a subtask when the table gives them", () => {
    expect(
      HISTORY_TEXT.dispatchBody(
        [
          { n: 1, agent: "Claude", subagent: "taskpilot-implementer", model: "haiku", title: "A", deps: [] },
          { n: 2, agent: "Copilot", model: "gpt-5", title: "B", deps: [1] },
          { n: 3, agent: "Claude", title: "C", deps: [] },
        ],
        1,
      ),
    ).toBe("1. Claude · taskpilot-implementer · haiku — A\n2. Copilot · gpt-5 — B (sau việc 1)\n3. Claude — C");
    expect(HISTORY_TEXT.subtaskDone(1, "Claude", "taskpilot-implementer", "haiku")).toBe("Việc 1 xong · Claude · taskpilot-implementer · haiku");
    expect(HISTORY_TEXT.subtaskDone(2, "Copilot")).toBe("Việc 2 xong · Copilot");
  });

  it("writes a subtask's numbers under its report, saying what is unknown", () => {
    expect(HISTORY_TEXT.subtaskDoneBody("03-viec-1.md", { model: "claude-haiku-4-5", costUsd: 1.006, durationMs: 3_930_000 })).toBe(
      "Báo cáo: 03-viec-1.md\nSố liệu: model `claude-haiku-4-5` · 1 giờ 5 phút · $1.01",
    );
    expect(HISTORY_TEXT.metrics({ durationMs: 120_000 })).toBe("model không rõ · 2 phút · chi phí không có");
    expect(HISTORY_TEXT.subtaskDoneBody("03-viec-2.md")).toBe("Báo cáo: 03-viec-2.md");
  });
});
