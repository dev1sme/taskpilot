import { expect, test } from "@playwright/test";

test("loads the app without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("main.login")).toHaveCount(0);
  await expect(page.locator("#root")).not.toBeEmpty();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
