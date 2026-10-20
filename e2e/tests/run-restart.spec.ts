import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

// Runs are faked at the network layer: starting a real one would launch claude.
async function fakeRun(page: Page, phase: string) {
  const now = Date.now();
  const run = {
    repo: "/repo",
    taskKey: "PROJ-1",
    sessionId: "00000000-0000-4000-8000-000000000001",
    stepIndex: 0,
    phase,
    stepStartedAt: now,
    message: "Session đã dừng giữa chừng.",
    startedAt: now,
    updatedAt: now,
  };
  const steps = [
    {
      id: "investigate",
      title: "Điều tra & lên kế hoạch",
      gate: "approve",
      doneFile: "02-plan.md",
      outputs: [
        { id: "investigation", file: "01-investigation.md" },
        { id: "plan", file: "02-plan.md" },
      ],
    },
    {
      id: "implement",
      title: "Implement",
      gate: "approve",
      doneFile: "04-summary.md",
      outputs: [
        { id: "progress", file: "03-progress.md" },
        { id: "summary", file: "04-summary.md" },
      ],
    },
  ];
  const restarts: string[] = [];
  await page.route("**/api/tasks/PROJ-1/run", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { workflow: { source: "default", origin: "default", historyFile: "00-history.md", steps, outdated: false }, run } }) : route.fallback(),
  );
  await page.route("**/api/tasks/PROJ-1/run/restart", (route) => {
    restarts.push(route.request().method());
    return route.fulfill({ json: { ...run, phase: "starting" } });
  });
  return restarts;
}

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("a running task restarts from the toolbar after a confirmation", async ({ page }) => {
  const restarts = await fakeRun(page, "running");
  await page.goto("/#/tasks/PROJ-1");
  const toolbar = page.locator(".toolbar");
  await expect(toolbar.getByRole("button", { name: "Huỷ", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "Chạy lại từ đầu" }).click();
  await expect(toolbar.getByText("Bản cũ của tài liệu được lưu vào archive/")).toBeVisible();
  expect(restarts).toEqual([]);
  await toolbar.getByRole("button", { name: "Xác nhận chạy lại" }).click();
  await expect.poll(() => restarts).toEqual(["POST"]);
});

test("an interrupted task offers restart next to resending the step", async ({ page }) => {
  const restarts = await fakeRun(page, "interrupted");
  await page.goto("/#/tasks/PROJ-1");
  const card = page.locator(".now-card");
  await expect(card.getByRole("button", { name: "Gửi lại bước" })).toBeVisible();
  await expect(page.locator(".toolbar").getByRole("button", { name: "Chạy lại từ đầu" })).toHaveCount(0);
  await card.getByRole("button", { name: "Chạy lại từ đầu" }).click();
  await expect.poll(() => restarts).toEqual(["POST"]);
});
