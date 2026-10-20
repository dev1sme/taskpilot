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

// File actions live in the toolbar under the header; the header keeps only the search button.
for (const route of ["/memory", "/settings", "/hooks", "/mcp", "/agents"]) {
  test(`#${route} header has no buttons besides search`, async ({ page }) => {
    await page.goto(`/#${route}`);
    await expect(page.locator(".config-toolbar")).toBeVisible();
    await expect(page.locator(".page-header button:not(.search-trigger), .page-header a")).toHaveCount(0);
    await expect(page.locator(".config-toolbar").getByRole("button", { name: "Tải lại" })).toBeVisible();
  });
}

test("CLAUDE.md edit actions stay in the toolbar while editing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/memory");
  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeVisible();
  await expect(page.locator(".page-header button:not(.search-trigger)")).toHaveCount(0);
  // Tabs and actions share one row at desktop width.
  const tab = await toolbar.getByRole("tab", { name: "CLAUDE.md", exact: true }).boundingBox();
  const save = await toolbar.getByRole("button", { name: "Xem thay đổi & lưu" }).boundingBox();
  expect(Math.abs(tab!.y + tab!.height / 2 - (save!.y + save!.height / 2))).toBeLessThan(8);
});

test("overview has no task list button", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.locator("main h1")).toHaveText("Tổng quan");
  await expect(page.getByRole("link", { name: "Mở danh sách task" })).toHaveCount(0);
});

test("link styled as a button is not underlined", async ({ page }) => {
  await page.goto("/#/");
  // The fixture has no task waiting (the only .btn link on a page), so check the stylesheet on a stand-in.
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.className = "btn btn-attention";
    a.href = "#/tasks";
    a.textContent = "probe";
    a.id = "btn-link-probe";
    document.querySelector("main")!.append(a);
  });
  await expect(page.locator("#btn-link-probe")).toHaveCSS("text-decoration-line", "none");
});
