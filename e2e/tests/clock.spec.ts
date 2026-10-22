import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);

/** One running task whose step started at `T0`, with tool calls at the given ages (ms before `T0`). */
async function mockRunning(page: Page, ages: number[]) {
  const task = {
    key: "RUN-1",
    title: "Việc đang chạy",
    stage: { done: 1, total: 3, step: null },
    historyFile: "00-history.md",
    specFiles: [],
    outputFiles: [],
    updatedAt: T0,
    run: { phase: "running", stepIndex: 0, stepStartedAt: T0 },
    waitingPermission: false,
    sessionsRunning: 0,
  };
  await page.route("**/api/tasks", (route) => route.fulfill({ json: [task] }));
  await page.route("**/api/tasks/RUN-1/activity*", (route) =>
    route.fulfill({
      json: ages.map((age, i) => ({ id: `t${i}`, sessionId: "s1", taskKey: "RUN-1", at: T0 - age, kind: "tool", summary: `Tool ${i}`, category: "run", status: "done" })),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("the running tile's timer counts up once a second", async ({ page }) => {
  await mockRunning(page, []);
  await page.clock.install({ time: T0 });
  await page.goto("/#/");
  const timer = page.locator(".tile-running .tile-timer time");
  await expect(timer).toBeVisible();
  // Freeze the page clock once loaded so the seconds below are exact.
  await page.clock.pauseAt(T0 + 10_000);
  await expect(timer).toHaveText("10s");
  await page.clock.runFor(3000);
  await expect(timer).toHaveText("13s");
  await page.clock.runFor(62_000);
  await expect(timer).toHaveText("1m 15s");
});

test("the pulse counts the tool calls of the last 12 minutes", async ({ page }) => {
  // Now, a minute ago and 10.5 minutes ago count; 13 minutes ago is outside the window.
  await mockRunning(page, [0, 60_000, 10.5 * 60_000, 13 * 60_000]);
  await page.clock.install({ time: T0 });
  await page.goto("/#/");
  await expect(page.locator(".tile-running .pulse")).toHaveAttribute("aria-label", "3 thao tác trong 12 phút qua");
  await expect(page.locator(".tile-running .pulse .is-on")).toHaveCount(3);
});
