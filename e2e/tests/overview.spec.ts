import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

const LONG = "Fix các bug tồn động - cải tiến hệ thống, dọn sạch override cũ và gộp usage ở footer cho gọn";

/** Seven tasks waiting on the user (each attention kind, long titles), one running, one idle. */
function tasks() {
  const now = Date.now();
  const phases = ["gate", "waiting", "interrupted", "gate", "waiting", "gate", "interrupted"];
  const waiting = phases.map((phase, i) => ({
    key: `WAIT-${i + 1}`,
    title: `${LONG} (${i + 1})`,
    stage: { done: 1, total: 3, step: null },
    historyFile: "00-history.md",
    specFiles: [],
    outputFiles: [],
    updatedAt: now - i * 60_000,
    run: { phase, stepIndex: 0, stepStartedAt: now },
    waitingPermission: i === 0,
    sessionsRunning: 0,
  }));
  return [
    ...waiting,
    { ...waiting[0], key: "RUN-1", title: LONG, run: { phase: "running", stepIndex: 0, stepStartedAt: now }, waitingPermission: false },
    { ...waiting[0], key: "IDLE-1", title: "Việc chưa chạy", run: null, waitingPermission: false, stage: { done: 0, total: 3, step: null } },
  ];
}

const LONG_TOOL = `Chạy npm --prefix e2e test -- ${"tests/some-really-long-spec-file-name.spec.ts ".repeat(8)}`;

async function mockTasks(page: Page) {
  await page.route("**/api/tasks", (route) => route.fulfill({ json: tasks() }));
  await page.route("**/api/tasks/RUN-1/activity*", (route) =>
    route.fulfill({
      json: [{ id: "t1", sessionId: "s1", taskKey: "RUN-1", at: Date.now(), kind: "tool", summary: LONG_TOOL, category: "run", status: "running" }],
    }),
  );
}

/** `el` fits inside its own box, and every box in `inner` lies within `el`'s box. */
async function expectContained(page: Page, selector: string, inner: string) {
  const el = page.locator(selector);
  const [scroll, client] = await el.evaluate((x) => [x.scrollWidth, x.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
  const box = (await el.boundingBox())!;
  for (const child of await el.locator(inner).all()) {
    const b = (await child.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
}

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
  await mockTasks(page);
});

for (const width of [1440, 1100, 390]) {
  test(`waiting tasks stay inside the hero card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    const hero = page.locator(".tile-hero");
    await expect(hero.locator(".hero-number")).toHaveText("7");
    await expect(hero.locator(".needs > li").first()).toBeVisible();
    await expectContained(page, ".tile-hero", ".needs > li, .needs .btn, .needs-all");
    // Five rows, then a way to the rest.
    await expect(hero.locator(".needs > li")).toHaveCount(5);
    const all = hero.getByRole("link", { name: "Xem tất cả 7 việc chờ" });
    await expect(all).toHaveAttribute("href", "#/tasks");
    // The long title wraps instead of pushing the button out.
    const title = hero.locator(".need-title").first();
    await expect(title).toContainText("WAIT-1");
    const [titleScroll, titleClient] = await title.evaluate((x) => [x.scrollWidth, x.clientWidth]);
    expect(titleScroll).toBeLessThanOrEqual(titleClient);
    const main = page.locator("main");
    const [mainScroll, mainClient] = await main.evaluate((x) => [x.scrollWidth, x.clientWidth]);
    expect(mainScroll).toBeLessThanOrEqual(mainClient);
  });
}

test("a long running tool line ends with an ellipsis inside its tile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/");
  const tool = page.locator(".tile-running .live-tool");
  await expect(tool).toContainText("npm --prefix e2e test");
  await expectContained(page, ".tile-running", ".live-tool");
  const text = tool.locator(".live-tool-text");
  await expect(text).toHaveCSS("text-overflow", "ellipsis");
  const [scroll, client] = await text.evaluate((x) => [x.scrollWidth, x.clientWidth]);
  expect(scroll).toBeGreaterThan(client);
});

test("no 'see all' link when every waiting task fits", async ({ page }) => {
  await page.unroute("**/api/tasks");
  await page.route("**/api/tasks", (route) => route.fulfill({ json: tasks().slice(2) }));
  await page.goto("/#/");
  const hero = page.locator(".tile-hero");
  await expect(hero.locator(".needs > li")).toHaveCount(5);
  await expect(hero.locator(".needs-all")).toHaveCount(0);
});
