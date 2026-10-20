import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

// Usage comes from a real session's status line; the API is faked here.
test("the footer shows plan usage and warns near the limit", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        fiveHour: { usedPercentage: 85, resetsAt: now + 3_600_000 },
        sevenDay: { usedPercentage: 39.4, resetsAt: now + 86_400_000 },
        updatedAt: now,
      },
    }),
  );
  await page.goto("/#/");
  const item = page.locator("footer.status-bar .status-usage");
  await expect(item).toContainText("5h 85% · 7d 39%");
  await expect(item).toHaveClass(/is-warn/);
  await expect(item).toHaveAttribute("title", /5h reset lúc/);
});

test("the footer hides usage until a session reports it", async ({ page }) => {
  await page.route("**/api/usage", (route) => route.fulfill({ json: null }));
  await page.goto("/#/");
  await expect(page.locator("footer.status-bar")).toBeVisible();
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(0);
});
