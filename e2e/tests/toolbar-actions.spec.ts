import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("skill editor saves and cancels from the toolbar", async ({ page }) => {
  await page.goto("/#/skills");
  await page.locator(".library-detail").getByRole("button", { name: "Sửa", exact: true }).click();
  const toolbar = page.locator(".toolbar");
  await expect(page.locator(".lib-editor")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeVisible();
  await expect(page.locator(".lib-editor button")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".lib-editor")).toHaveCount(0);
});

test("mcp form saves and cancels from the toolbar", async ({ page }) => {
  await page.goto("/#/mcp");
  const toolbar = page.locator(".toolbar");
  await toolbar.getByRole("group", { name: "Thêm server vào" }).getByRole("button", { name: "Project" }).click();
  await expect(page.locator(".mcp-form")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeDisabled();
  await expect(page.locator(".mcp-form .perm-actions")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".mcp-form")).toHaveCount(0);
});
