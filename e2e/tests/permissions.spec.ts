import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("editing permissions keeps a default mode the editor does not offer", async ({ page }) => {
  // The fixture file has no such mode: take the real response and change only defaultMode.
  await page.route("**/api/config/settings/project/permissions", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), defaultMode: "bypassPermissions" } });
  });

  await page.goto("/#/settings");
  await page.locator(".config-toolbar").getByRole("button", { name: "Sửa", exact: true }).click();

  const select = page.getByLabel("Chế độ mặc định");
  await expect(select).toHaveValue("bypassPermissions");
  await expect(select.locator("option:checked")).toHaveText("bypassPermissions (giữ như trong file)");

  // The mode can be changed to an offered one, and the extra option stays selectable again.
  await select.selectOption("plan");
  await expect(select).toHaveValue("plan");
  await select.selectOption("bypassPermissions");
  await expect(select).toHaveValue("bypassPermissions");
});

test("a mode the file does not have is not offered", async ({ page }) => {
  await page.goto("/#/settings");
  await page.locator(".config-toolbar").getByRole("button", { name: "Sửa", exact: true }).click();
  const select = page.getByLabel("Chế độ mặc định");
  await expect(select.locator("option")).toHaveCount(5);
  await expect(select.locator('option[value="bypassPermissions"]')).toHaveCount(0);
});
