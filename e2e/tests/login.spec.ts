import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, E2E_USER } from "../env";

test.use({ storageState: { cookies: [], origins: [] } });

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tên đăng nhập").fill(E2E_USER);
  await page.getByLabel("Mật khẩu").fill("wrong");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toHaveText("Sai tên đăng nhập hoặc mật khẩu");
  await expect(page.getByLabel("Mật khẩu")).toHaveValue("");
});

test("logs in with the right password", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tên đăng nhập").fill(E2E_USER);
  await page.getByLabel("Mật khẩu").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator("main.login")).toBeHidden();
});

test("logs out from the sidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tên đăng nhập").fill(E2E_USER);
  await page.getByLabel("Mật khẩu").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.locator("main.login")).toBeHidden();
  await page.locator("nav.sidebar").getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
});
