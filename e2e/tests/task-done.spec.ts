import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

type Run = { phase: string; stepIndex: number; stepStartedAt: number } | null;

function task(key: string, over: { done?: { at: number | null } | null; run?: Run } = {}) {
  return {
    key,
    title: `Việc ${key}`,
    stage: { done: 0, total: 3, step: null },
    historyFile: "00-history.md",
    specFiles: [],
    outputFiles: [],
    updatedAt: Date.now(),
    done: over.done ?? null,
    run: over.run ?? null,
    waitingPermission: false,
    sessionsRunning: 0,
  };
}

// The task list is faked at the network layer: the real server would write task.yml in the fixture repo.
async function fakeTasks(page: Page) {
  const state = {
    OPEN: task("OPEN-1"),
    DONE: task("DONE-1", { done: { at: Date.now() } }),
    BUSY: task("BUSY-1", { run: { phase: "running", stepIndex: 0, stepStartedAt: Date.now() } }),
  };
  const puts: Array<{ key: string; body: unknown }> = [];
  await page.route("**/api/tasks", (route) => route.fulfill({ json: Object.values(state) }));
  await page.route("**/api/tasks/*/done", async (route) => {
    const key = route.request().url().split("/").slice(-2)[0]!;
    const body = route.request().postDataJSON() as { done: boolean };
    puts.push({ key, body });
    const entry = Object.values(state).find((t) => t.key === key)!;
    entry.done = body.done ? { at: Date.now() } : null;
    await route.fulfill({ json: { ok: true } });
  });
  return puts;
}

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("filters open and done tasks, remembering the choice", async ({ page }) => {
  await fakeTasks(page);
  await page.goto("/#/tasks");
  const filter = page.getByRole("group", { name: "Lọc task" });
  await expect(filter.getByRole("button", { name: /Đang làm/ })).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator("main tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("link", { name: /DONE-1/ })).toHaveCount(0);

  await filter.getByRole("button", { name: /Hoàn thành/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("DONE-1");

  await filter.getByRole("button", { name: /Tất cả/ }).click();
  await expect(rows).toHaveCount(3);

  await page.reload();
  await expect(page.getByRole("group", { name: "Lọc task" }).getByRole("button", { name: /Tất cả/ })).toHaveAttribute("aria-pressed", "true");
});

test("the row button marks a task done and reopens it with PUT /done", async ({ page }) => {
  const puts = await fakeTasks(page);
  await page.goto("/#/tasks");
  const markDone = page.getByRole("button", { name: "Đánh dấu OPEN-1 hoàn thành" });
  const request = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/tasks/OPEN-1/done"));
  await markDone.click();
  expect((await request).postDataJSON()).toEqual({ done: true });
  expect(puts).toEqual([{ key: "OPEN-1", body: { done: true } }]);

  // The list refetches: the task leaves "Đang làm" and shows up under "Hoàn thành".
  await expect(page.getByRole("link", { name: /OPEN-1/ })).toHaveCount(0);
  await page
    .getByRole("group", { name: "Lọc task" })
    .getByRole("button", { name: /Hoàn thành/ })
    .click();
  await page.getByRole("button", { name: "Mở lại OPEN-1" }).click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({ key: "OPEN-1", body: { done: false } });
});

test("the button is disabled while the task has an active run", async ({ page }) => {
  const puts = await fakeTasks(page);
  await page.goto("/#/tasks");
  const button = page.getByRole("button", { name: "Đánh dấu BUSY-1 hoàn thành" });
  await expect(button).toBeDisabled();
  await expect(page.locator("td.task-action[title]")).toHaveAttribute("title", /Quy trình đang chạy/);
  await button.click({ force: true }).catch(() => undefined);
  expect(puts).toHaveLength(0);
});

test("long statuses and titles fit a 390px screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Long titles and many "Chờ xác nhận" rows, as in a real repo, must not widen the page.
  const complete = (key: string) => ({ ...task(key), title: `Việc ${key} có tiêu đề khá dài để thử cắt chữ trên điện thoại`, stage: { done: 3, total: 3, step: "Rà soát" } });
  await page.route("**/api/tasks", (route) => route.fulfill({ json: [complete("LONG-1"), complete("LONG-2"), complete("LONG-3")] }));
  await page.goto("/#/tasks");
  await expect(page.locator("main tbody tr")).toHaveCount(3);
  const [docScroll, docClient] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(docScroll).toBeLessThanOrEqual(docClient);
  const [tableScroll, tableClient] = await page.locator(".task-table-wrap").evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(tableScroll).toBeLessThanOrEqual(tableClient);
  await expect(page.getByRole("button", { name: "Đánh dấu LONG-1 hoàn thành" })).toBeInViewport({ ratio: 1 });
});
