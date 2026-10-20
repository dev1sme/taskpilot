import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE, E2E_PASSWORD, E2E_USER } from "../env";

// Logs in once and saves the session cookie; the chromium project starts every test from it.
setup("log in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tên đăng nhập").fill(E2E_USER);
  await page.getByLabel("Mật khẩu").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator("main.login")).toBeHidden();
  await page.context().storageState({ path: AUTH_FILE });
});
