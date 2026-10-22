import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

const QUESTIONS = [
  { n: 1, text: "Đổi tên bước 2?", proposal: "đổi thành Triển khai" },
  { n: 2, text: "Tách phần G ra task riêng?", proposal: "giữ" },
  { n: 3, text: "Có cần banner?" },
];

// Runs are faked at the network layer (as in run-restart.spec.ts): a real one would launch claude.
async function fakeRun(page: Page, phase: "gate" | "waiting") {
  const now = Date.now();
  const run = {
    repo: "/repo",
    taskKey: "PROJ-1",
    sessionId: "00000000-0000-4000-8000-000000000001",
    stepIndex: 0,
    phase,
    stepStartedAt: now,
    message: phase === "gate" ? 'Bước "Điều tra & lên kế hoạch" xong, chờ duyệt.' : "Claude đã dừng nhưng chưa ghi 02-plan.md.",
    lastMessage: "Cần ba chốt vài điểm.",
    sentPrompt: { stepIndex: 0, text: "## Bối cảnh\n\nBạn đang làm task PROJ-1", at: now },
    startedAt: now,
    updatedAt: now,
  };
  const steps = [
    { id: "investigate", title: "Điều tra & lên kế hoạch", agent: "claude", gate: "approve", doneFile: "02-plan.md", outputs: [{ id: "plan", file: "02-plan.md" }] },
    { id: "implement", title: "Triển khai", agent: "claude", gate: "approve", doneFile: "04-summary.md", outputs: [{ id: "summary", file: "04-summary.md" }] },
  ];
  const sent: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/tasks/PROJ-1/run", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { workflow: { source: "default", origin: "default", historyFile: "00-history.md", steps, outdated: false }, run, questions: QUESTIONS } })
      : route.fallback(),
  );
  await page.route(/\/api\/tasks\/PROJ-1\/run\/(approve|feedback|reply)$/, (route) => {
    sent.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: run });
  });
  return sent;
}

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("at the gate each question gets its own answer; approving sends them along", async ({ page }) => {
  const sent = await fakeRun(page, "gate");
  await page.goto("/#/tasks/PROJ-1");
  const form = page.getByRole("group", { name: "Claude hỏi 3 câu" });
  await expect(form).toContainText("Đổi tên bước 2?");
  // Questions with a proposal start on it; the one without asks for an answer.
  await expect(form.getByRole("radio", { name: "Theo đề xuất: đổi thành Triển khai" })).toBeChecked();
  await form.getByRole("radiogroup", { name: "Trả lời câu 2" }).getByRole("radio", { name: "Trả lời khác" }).check();
  await form.getByRole("textbox", { name: "Câu trả lời cho câu 2" }).fill("Tách ra TPL-009");
  await form.getByRole("textbox", { name: "Câu trả lời cho câu 3" }).fill("Không");

  await page.getByRole("button", { name: "Duyệt kèm trả lời, sang bước tiếp" }).click();
  await expect.poll(() => sent).toEqual([
    {
      url: "/api/tasks/PROJ-1/run/approve",
      body: {
        note: [
          "1. Đổi tên bước 2?\n   → Theo đề xuất: đổi thành Triển khai",
          "2. Tách phần G ra task riêng?\n   → Tách ra TPL-009",
          "3. Có cần banner?\n   → Không",
        ].join("\n"),
      },
    },
  ]);
});

test("the answers can go back to Claude as feedback, with an extra note", async ({ page }) => {
  const sent = await fakeRun(page, "gate");
  await page.goto("/#/tasks/PROJ-1");
  const form = page.getByRole("group", { name: "Claude hỏi 3 câu" });
  await form.getByRole("radiogroup", { name: "Trả lời câu 2" }).getByRole("radio", { name: "Chưa trả lời" }).check();
  await page.getByRole("textbox", { name: /gửi các câu trả lời như góp ý/ }).fill("Thêm test e2e");
  await page.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect.poll(() => sent).toEqual([
    { url: "/api/tasks/PROJ-1/run/feedback", body: { text: "1. Đổi tên bước 2?\n   → Theo đề xuất: đổi thành Triển khai\n\nThêm test e2e" } },
  ]);
});

test("while Claude waits, it is answered from the card instead of the terminal", async ({ page }) => {
  const sent = await fakeRun(page, "waiting");
  await page.goto("/#/tasks/PROJ-1");
  const card = page.locator(".now-card");
  await expect(card.getByRole("group", { name: "Claude hỏi 3 câu" })).toBeVisible();
  await card.getByRole("textbox", { name: "Câu trả lời cho câu 3" }).fill("Có");
  await card.getByRole("button", { name: "Gửi trả lời" }).click();
  await expect.poll(() => sent).toEqual([
    {
      url: "/api/tasks/PROJ-1/run/reply",
      body: { text: "1. Đổi tên bước 2?\n   → Theo đề xuất: đổi thành Triển khai\n2. Tách phần G ra task riêng?\n   → Theo đề xuất: giữ\n3. Có cần banner?\n   → Có" },
    },
  ]);
});

test("the prompt sent to the task opens from the toolbar", async ({ page }) => {
  await fakeRun(page, "waiting");
  await page.goto("/#/tasks/PROJ-1");
  await page.locator(".toolbar").getByRole("button", { name: "Prompt đã gửi" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("Prompt đã gửi · Điều tra & lên kế hoạch");
  await expect(viewer.locator(".viewer-text")).toHaveText("## Bối cảnh\n\nBạn đang làm task PROJ-1");
});
