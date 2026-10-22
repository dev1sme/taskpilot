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

test("saving leaves a toast that links to Lịch sử thay đổi", async ({ page }) => {
  // The write is faked so the shared fixture's CLAUDE.md stays as it is for the other tests.
  await page.route("**/api/config/memory/project", (route) =>
    route.request().method() === "PUT" ? route.fulfill({ json: { ok: true, hash: "next" } }) : route.fallback(),
  );
  await page.goto("/#/memory");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" thêm");
  await page.getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Lưu/ }).click();
  const link = page.locator(".toast").getByRole("link", { name: "Xem bản cũ" });
  await expect(link).toHaveAttribute("href", "#/backups");
});
