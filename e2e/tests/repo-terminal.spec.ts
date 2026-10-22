import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

// Sessions run e2e/fake-claude.sh (TASKPILOT_CLAUDE), never the real claude.
test("the footer opens a repo terminal that stays open across pages", async ({ page }) => {
  await page.goto("/#/");
  const footer = page.locator("footer.status-bar");
  const toggle = footer.getByRole("button", { name: /^Terminal/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".repo-terminal")).toHaveCount(0);

  await toggle.click();
  const drawer = page.getByRole("region", { name: "Terminal repo" });
  await expect(drawer).toBeVisible();
  // "Session mới" asks which agent to open; the fake claude stands in for Claude.
  await drawer.getByRole("button", { name: "Session mới" }).click();
  await drawer.getByRole("button", { name: "Session Claude" }).click();
  const session = drawer.locator(".drawer-session.is-active");
  await expect(session).toContainText("Session");
  const title = (await session.textContent())!.replace(/,.*$/, "").trim();
  await expect(drawer.locator(".xterm")).toContainText("fake claude");
  await expect(footer.locator(".status-count")).toHaveText(/\d+/);

  // The drawer lives in the shell, so navigating keeps it and its session.
  await page.goto("/#/skills");
  await expect(drawer.locator(".drawer-session.is-active")).toContainText(title);
  await page.goto("/#/tasks");
  await expect(drawer).toBeVisible();

  // The task page has its own drawer; repo sessions do not show up there.
  await page.goto("/#/tasks/PROJ-1");
  const taskDrawer = page.getByRole("region", { name: "Terminal", exact: true });
  await expect(taskDrawer).toBeVisible();
  await expect(taskDrawer.locator(".drawer-session")).toHaveCount(0);
  await expect(drawer).toBeVisible();

  // Clean up: stop, remove, close.
  await drawer.getByRole("button", { name: "Dừng" }).click();
  await drawer.getByRole("button", { name: "Xóa", exact: true }).click();
  await drawer.getByRole("button", { name: "Xác nhận xóa" }).click();
  await expect(drawer.locator(".drawer-session")).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".repo-terminal")).toHaveCount(0);
});
