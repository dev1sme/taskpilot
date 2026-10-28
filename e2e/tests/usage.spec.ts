import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

const usageButton = (page: Page) => page.locator("footer.status-bar button.status-usage");
const usageDialog = (page: Page) => page.getByRole("dialog", { name: "Chi tiết usage" });

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
  const button = usageButton(page);
  await expect(button).toHaveText("Usage");
  await expect(button).toHaveClass(/is-warn/);
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.click();
  const dialog = usageDialog(page);
  await expect(dialog).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toContainText("5h reset lúc");
  await expect(dialog).toContainText("7d reset lúc");
  await expect(dialog.locator(".usage-meters li.is-warn")).toHaveCount(1);

  // A click outside closes it.
  await page.locator(".main").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toHaveCount(0);
});

test("the usage popover works from the keyboard", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) => route.fulfill({ json: { fiveHour: { usedPercentage: 20, resetsAt: now + 3_600_000 }, updatedAt: now } }));
  await page.goto("/#/");
  const button = usageButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = usageDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
});

test("the footer merges copilot's quota into the same usage button", async ({ page }) => {
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
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(1);
  const button = usageButton(page);
  await expect(button).toHaveText("Usage");
  await expect(button).toHaveClass(/is-warn/);

  await button.click();
  const dialog = usageDialog(page);
  const claude = dialog.locator(".usage-agent").filter({ has: page.getByRole("heading", { name: "Claude" }) });
  const copilot = dialog.locator(".usage-agent").filter({ has: page.getByRole("heading", { name: "Copilot" }) });
  await expect(claude.locator("li.is-warn")).toHaveCount(0);
  await expect(claude.locator(".usage-version")).toHaveText(/^claude |chưa có claude/);
  await expect(copilot).toContainText("Đã dùng 255/300 premium requests");
  await expect(copilot).toContainText("premium requests reset lúc");
  await expect(copilot.locator(".usage-meter-value")).toHaveText("85%");
  await expect(copilot.locator("li.is-warn")).toHaveCount(1);
});

test("the footer shows an unlimited copilot account without claude's usage", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: { agents: { copilot: { usedPercentage: null, unlimited: true, unit: "ai_credits", used: 0, entitlement: null, resetsAt: null, updatedAt: now } } },
    }),
  );
  await page.goto("/#/");
  const button = usageButton(page);
  await expect(button).toHaveText("Usage");
  await expect(button).not.toHaveClass(/is-warn/);
  await button.click();
  const dialog = usageDialog(page);
  await expect(dialog).toContainText("Không giới hạn ở mức tài khoản (AI credits)");
  await expect(dialog).toContainText("Chưa có số liệu");
});

test("the footer shows codex's 5h/7d account limits next to the others", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        agents: {
          codex: {
            fiveHour: { usedPercentage: 30, resetsAt: now + 3_600_000 },
            sevenDay: { usedPercentage: 85.4, resetsAt: now + 86_400_000 },
            credits: { hasCredits: true, unlimited: false, balance: "12.5" },
            planType: "plus",
            updatedAt: now,
          },
        },
      },
    }),
  );
  await page.goto("/#/");
  const button = usageButton(page);
  await expect(button).toHaveText("Usage");
  await expect(button).toHaveClass(/is-warn/);

  await button.click();
  const codex = usageDialog(page)
    .locator(".usage-agent")
    .filter({ has: page.getByRole("heading", { name: "Codex" }) });
  await expect(codex).toContainText("5h reset lúc");
  await expect(codex).toContainText("7d reset lúc");
  await expect(codex).toContainText("Gói plus");
  await expect(codex).toContainText("Credits còn lại: 12.5");
  await expect(codex.locator("li.is-warn")).toHaveCount(1);
});

test("a codex update with no window numbers keeps the usage button hidden", async ({ page }) => {
  await page.route("**/api/usage", (route) => route.fulfill({ json: { agents: { codex: { planType: "plus", updatedAt: Date.now() } } } }));
  await page.goto("/#/");
  await expect(page.locator("footer.status-bar")).toBeVisible();
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(0);
});

test("the footer hides usage until a session reports it", async ({ page }) => {
  await page.route("**/api/usage", (route) => route.fulfill({ json: null }));
  await page.goto("/#/");
  await expect(page.locator("footer.status-bar")).toBeVisible();
  await expect(page.locator("footer.status-bar .status-usage")).toHaveCount(0);
});

const fullUsage = (now: number) => ({
  fiveHour: { usedPercentage: 42, resetsAt: now + 3_600_000 },
  sevenDay: { usedPercentage: 18, resetsAt: now + 86_400_000 },
  spend: { usedPercentage: 7 },
  updatedAt: now,
  agents: {
    copilot: { usedPercentage: 9, unlimited: false, unit: "premium_requests", used: 27, entitlement: 300, resetsAt: now + 86_400_000, updatedAt: now },
    codex: { fiveHour: { usedPercentage: 30, resetsAt: now + 3_600_000 }, updatedAt: now },
  },
});

test("the footer stays on one line at 1440px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/usage", (route) => route.fulfill({ json: fullUsage(Date.now()) }));
  await page.goto("/#/");
  await expect(usageButton(page)).toHaveText("Usage");
  const footer = page.locator("footer.status-bar");
  const footerBox = (await footer.boundingBox())!;
  const buttonBox = (await usageButton(page).boundingBox())!;
  // One line: the footer is no taller than its padding plus one item.
  expect(footerBox.height).toBeLessThanOrEqual(buttonBox.height + 20);
});

test('on a phone the usage button is just "Usage" and the popover shows every agent and fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/usage", (route) => route.fulfill({ json: fullUsage(Date.now()) }));
  await page.goto("/#/");
  const button = usageButton(page);
  await expect(button).toHaveText("Usage");
  await expect(button.locator(".usage-peak")).toHaveCount(0);

  await button.click();
  const dialog = usageDialog(page);
  await expect(dialog.locator(".usage-meter-value")).toHaveText(["42%", "18%", "7%", "9%", "30%"]);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("missing copilot figures are distinct from an unlimited entitlement", async ({ page }) => {
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        agents: { copilot: { usedPercentage: null, unlimited: false, unit: "ai_credits", used: null, entitlement: null, resetsAt: null, updatedAt: Date.now() } },
      },
    }),
  );
  await page.goto("/#/");
  await usageButton(page).click();
  const copilot = usageDialog(page)
    .locator(".usage-agent")
    .filter({ has: page.getByRole("heading", { name: "Copilot", exact: true }) });
  await expect(copilot.locator(".usage-meter-value")).toHaveText("Chưa có số liệu");
  await expect(copilot.locator(".usage-bar")).toHaveCount(0);
  await expect(copilot).not.toContainText("Không giới hạn");
  await expect(usageButton(page)).not.toHaveClass(/is-warn/);
});

test("mixed providers keep native units, freshness and versions from their own sources", async ({ page }) => {
  const now = Date.now();
  await page.route("**/api/info", (route) => route.fulfill({ json: { claudeVersion: "legacy", versions: { claude: "claude-map", copilot: "copilot-map", codex: "codex-map" } } }));
  await page.route("**/api/usage", (route) =>
    route.fulfill({
      json: {
        fiveHour: { usedPercentage: 0, resetsAt: now - 3_600_000 },
        updatedAt: now - 7_200_000,
        agents: {
          copilot: { usedPercentage: null, unlimited: true, unit: "ai_credits", used: null, entitlement: null, resetsAt: null, updatedAt: now },
          codex: { sevenDay: { usedPercentage: 86, resetsAt: now + 86_400_000 }, credits: { unlimited: true, hasCredits: true, balance: null }, updatedAt: now },
        },
      },
    }),
  );
  await page.goto("/#/");
  await usageButton(page).click();
  const groups = usageDialog(page).locator(".usage-agent");
  await expect(groups.locator(".usage-meter-value")).toHaveText(["0%", "∞", "86%"]);
  await expect(groups.locator(".usage-version")).toHaveText(["claude claude-map", "copilot copilot-map", "codex codex-map"]);
  await expect(groups.nth(0)).toContainText("có thể đã cũ");
  await expect(groups.nth(1)).not.toContainText("có thể đã cũ");
  await expect(groups.nth(2)).not.toContainText("5h");
  await expect(groups.nth(2)).toContainText("Credits không giới hạn");
  await expect(page.locator(".account-versions span")).toHaveText(["claude claude-map", "copilot copilot-map", "codex codex-map"]);
});

test("explicit missing Claude version wins over the legacy version and other provider counts stay absent", async ({ page }) => {
  await page.route("**/api/info", (route) => route.fulfill({ json: { claudeVersion: "legacy", versions: { claude: null, copilot: "copilot-only" } } }));
  await page.goto("/#/");
  await expect(page.locator(".account-versions span")).toHaveText(["chưa có claude", "copilot copilot-only"]);
  for (const cli of ["copilot", "codex"]) {
    await page.goto(`/#/memory?cli=${cli}`);
    for (const section of ["hooks", "agents", "mcp"]) {
      const link = page.locator(`#sidebar a[href="#/${section}?cli=${cli}"]`);
      await expect(link).toHaveCount(1);
      await expect(link.locator(".nav-badge")).toHaveCount(0);
    }
  }
});

for (const width of [1440, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`usage visual check ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((value) => localStorage.setItem("taskpilot.theme", value), theme);
      await page.route("**/api/usage", (route) => route.fulfill({ json: fullUsage(Date.now()) }));
      await page.goto("/#/");
      await usageButton(page).click();
      await expect(usageDialog(page)).toBeVisible();
      const box = (await usageDialog(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `/tmp/taskpilot-usage-${width}-${theme}.png`, animations: "disabled" });
    });
  }
}
