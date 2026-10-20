import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("opening an editor without changes is not unsaved", async ({ page }) => {
  await page.goto("/#/memory");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);

  // Nothing to lose: cancel closes the editor without asking.
  await page.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
});

test("an edited draft is unsaved and cancelling asks first", async ({ page }) => {
  await page.goto("/#/memory");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" thêm");
  await expect(page.getByText("Chưa lưu")).toBeVisible();

  await page.getByRole("button", { name: "Huỷ" }).click();
  await page.getByRole("button", { name: "Bỏ thay đổi" }).click();
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
});
