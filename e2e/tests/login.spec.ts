import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, E2E_USER } from "../env";

// A fresh context: no saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("a wrong password is refused, the right one opens the app", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tên đăng nhập").fill(E2E_USER);
  await page.getByLabel("Mật khẩu").fill("wrong");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByLabel("Mật khẩu").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("navigation", { name: "Điều hướng" })).toBeVisible();
});
