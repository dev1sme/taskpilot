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

test("the footer shows copilot's quota apart from claude's usage", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        fiveHour: { usedPercentage: 20, resetsAt: now + 3_600_000 },
        updatedAt: now,
        agents: {
          copilot: { usedPercentage: 85, unlimited: false, unit: "premium_requests", used: 255, entitlement: 300, resetsAt: now + 86_400_000, updatedAt: now },
        },
      },
    }),
  );
  await page.goto("/#/");
  const claude = page.locator("footer.status-bar .status-usage:not(.status-usage-copilot)");
  await expect(claude).toContainText("5h 20%");
  await expect(claude).not.toHaveClass(/is-warn/);
  const copilot = page.locator("footer.status-bar .status-usage-copilot");
  await expect(copilot).toContainText("Copilot 85%");
  await expect(copilot).toHaveClass(/is-warn/);
  await expect(copilot).toHaveAttribute("title", /Đã dùng 255\/300 premium requests/);
});

test("the footer shows an unlimited copilot account without claude's usage", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: { agents: { copilot: { usedPercentage: null, unlimited: true, unit: "ai_credits", used: 0, entitlement: null, resetsAt: null, updatedAt: now } } },
    }),
  );
  await page.goto("/#/");
  const copilot = page.locator("footer.status-bar .status-usage-copilot");
  await expect(copilot).toContainText("Copilot ∞");
  await expect(copilot).not.toHaveClass(/is-warn/);
  await expect(copilot).toHaveAttribute("title", /Không giới hạn ở mức tài khoản \(AI credits\)/);
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(1);
});

test("the footer hides usage until a session reports it", async ({ page }) => {
  await page.route("**/api/usage", (route) => route.fulfill({ json: null }));
  await page.goto("/#/");
  await expect(page.locator("footer.status-bar")).toBeVisible();
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(0);
});
