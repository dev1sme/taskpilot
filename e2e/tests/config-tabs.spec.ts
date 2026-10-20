import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("settings shows one file per scope tab", async ({ page }) => {
  await page.goto("/#/settings");
  const tabs = page.getByRole("tablist", { name: "File settings" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(page.locator(".scope-section")).toHaveCount(1);
  await expect(page.locator(".scope-section h2")).toHaveText(".claude/settings.json");
  await expect(page.getByText("npm test:*")).toBeVisible();

  await tabs.getByRole("tab", { name: ".claude/settings.local.json" }).click();
  await expect(page.locator(".scope-section h2")).toHaveText(".claude/settings.local.json");
  await expect(page.getByText("npm test:*")).toHaveCount(0);
  await expect(page.getByText('Bấm "Sửa quyền" ở từng file')).toHaveCount(0);
});

test("settings edit opens from the toolbar and cancels", async ({ page }) => {
  await page.goto("/#/settings");
  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa quyền" }).click();
  await expect(page.locator(".perm-editor")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".perm-editor")).toHaveCount(0);
});

test("hooks shows the JSON block of the file and edits from the toolbar", async ({ page }) => {
  await page.goto("/#/hooks");
  const code = page.locator(".code-view");
  await expect(code).toContainText('"PostToolUse": [');
  await expect(code).toContainText('"command": "npx prettier --write ."');
  await expect(page.getByRole("navigation", { name: "Sự kiện" })).toContainText("PostToolUse");

  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa hooks" }).click();
  await expect(page.locator(".hooks-editor")).toBeVisible();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".hooks-editor")).toHaveCount(0);
});

test("hooks tab of a file without hooks offers to add one", async ({ page }) => {
  await page.goto("/#/hooks");
  await page.getByRole("tab", { name: ".claude/settings.local.json" }).click();
  await expect(page.getByText(".claude/settings.local.json chưa có hook nào")).toBeVisible();
  await page.locator(".config-toolbar").getByRole("button", { name: "Thêm hook" }).click();
  await expect(page.locator(".hook-row")).toHaveCount(1);
  // The empty starter row alone is not an unsaved change.
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
});
