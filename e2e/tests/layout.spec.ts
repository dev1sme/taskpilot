import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ["/", "/tasks", "/tasks/PROJ-1", "/memory", "/settings", "/hooks", "/mcp"]) {
    test(`#${route} has no horizontal overflow`, async ({ page }) => {
      await page.goto(`/#${route}`);
      await expect(page.locator("main h1")).toBeVisible();
      const main = page.locator("main");
      const [scroll, client] = await main.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }
});

test("header actions stay in one row while editing CLAUDE.md", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/memory");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  const reload = await page.getByRole("button", { name: "Tải lại" }).boundingBox();
  const search = await page.locator(".search-trigger").boundingBox();
  expect(Math.abs(reload!.y - search!.y)).toBeLessThan(8);
});

test("link styled as a button is not underlined", async ({ page }) => {
  await page.goto("/#/");
  const link = page.getByRole("link", { name: "Mở danh sách task" });
  await expect(link).toHaveCSS("text-decoration-line", "none");
});
