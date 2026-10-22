import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("a server another scope hides has no check button, only a hint", async ({ page }) => {
  await page.goto("/#/mcp");
  const detail = page.locator(".library-detail");

  // Project tab: `docs` is hidden by the local one, so a check would test the other copy.
  await expect(detail.getByRole("heading", { name: "docs" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Kiểm tra kết nối" })).toHaveCount(0);
  await expect(detail.getByText("Claude dùng bản ở Local; kiểm tra ở tab đó.")).toBeVisible();

  // Local tab: the winning copy keeps the button and has no hint.
  await page.getByRole("tablist", { name: "File MCP" }).getByRole("tab", { name: "~/.claude.json · repo này" }).click();
  await expect(detail.getByRole("heading", { name: "docs" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Kiểm tra kết nối" })).toBeVisible();
  await expect(detail.getByText(/kiểm tra ở tab đó/)).toHaveCount(0);
});
