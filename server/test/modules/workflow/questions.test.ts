import { describe, expect, it } from "vitest";
import { parseQuestions } from "../../../src/modules/workflow/questions.js";

describe("questions for the reviewer", () => {
  it("reads the numbered questions of a plan's open-questions section, with their proposals", () => {
    const plan = [
      "# A-1 — Kế hoạch",
      "",
      "## 3. Các bước",
      "1. Viết test",
      "2. Sửa code",
      "",
      "## 6. Câu hỏi mở",
      "",
      "1. **Tên bước 2**: đổi thành Triển khai? — Đề xuất: đổi, cho đồng bộ.",
      "2. Tách phần G ra task riêng?",
      "   Phần này lớn. (Đề xuất: giữ, làm cuối)",
      "3. Giữ API cũ - Đề xuất: không",
      "",
      "## 7. Khác",
      "1. Không phải câu hỏi",
    ].join("\n");
    expect(parseQuestions(plan)).toEqual([
      { n: 1, text: "Tên bước 2: đổi thành Triển khai?", proposal: "đổi, cho đồng bộ." },
      { n: 2, text: "Tách phần G ra task riêng? Phần này lớn.", proposal: "giữ, làm cuối" },
      { n: 3, text: "Giữ API cũ", proposal: "không" },
    ]);
  });

  it("finds nothing when the section says there is none", () => {
    expect(parseQuestions("## 6. Câu hỏi mở\n\nKhông có\n")).toEqual([]);
    expect(parseQuestions("## 6. Câu hỏi mở\n\n1. Không có\n")).toEqual([]);
  });

  it("reads a bold line about questions as a heading", () => {
    const entry = "**Quyết định:**\n1. Dùng A\n\n**Câu hỏi còn chờ reviewer:**\n1. Đổi tên? — Đề xuất: có\n";
    expect(parseQuestions(entry)).toEqual([{ n: 1, text: "Đổi tên?", proposal: "có" }]);
  });

  it("takes the last numbered list of a message only when its items read as questions", () => {
    const asking = "Mình đã đọc spec.\n\n1. Bước một xong\n\nCần ba chốt:\n\n1. Dùng Redis hay bộ nhớ? — Đề xuất: bộ nhớ\n2. Có cần migration?\n";
    expect(parseQuestions(asking)).toEqual([
      { n: 1, text: "Dùng Redis hay bộ nhớ?", proposal: "bộ nhớ" },
      { n: 2, text: "Có cần migration?" },
    ]);
    expect(parseQuestions("Đã xong:\n\n1. Sửa engine\n2. Thêm test\n")).toEqual([]);
    expect(parseQuestions("Xong, không có câu hỏi.")).toEqual([]);
  });
});
