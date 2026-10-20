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
  await toolbar.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".mcp-form")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeDisabled();
  await expect(page.locator(".mcp-form .perm-actions")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".mcp-form")).toHaveCount(0);
});

// Action buttons say only what they do; the full name is in the tooltip.
test("action buttons use short labels", async ({ page }) => {
  await page.goto("/#/skills");
  const add = page.locator(".toolbar").getByRole("button", { name: "Thêm", exact: true });
  await expect(add).toHaveAttribute("title", "Thêm skill vào .claude/skills");
  const card = page.locator(".library-detail");
  await expect(card.getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Xóa", exact: true }).click();
  await expect(card.getByRole("button", { name: "Xác nhận xóa" })).toBeVisible();

  await page.goto("/#/settings");
  await expect(page.locator(".toolbar").getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
  await page.goto("/#/hooks");
  await expect(page.locator(".toolbar").getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
});
