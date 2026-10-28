import { expect, test } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

// Every route but the start page loads on first visit: each must render its heading.
for (const [hash, heading] of [
  ["#/tasks", "Task"],
  ["#/tasks/PROJ-1", "Thêm trang đăng nhập bằng OAuth"],
  ["#/config/memory?cli=claude", "Hướng dẫn"],
  ["#/config/settings?cli=claude", "Settings & quyền"],
  ["#/config/hooks?cli=claude", "Hooks"],
  ["#/config/agents?cli=claude", "Thư viện"],
  ["#/config/mcp?cli=claude", "MCP servers"],
  ["#/config/workflow", "Workflow"],
  ["#/config/codegraph", "Codegraph"],
  ["#/backups", "Lịch sử thay đổi"],
] as const) {
  test(`${hash} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    expect(errors).toEqual([]);
  });
}

test("overview lists the repo's open task and its configuration", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("fixture-repo");
  await expect(page.getByRole("main").getByText(FIXTURE_REPO)).toBeVisible();
  const recent = page.getByRole("region", { name: "Đang làm dở" });
  await expect(recent.getByRole("link", { name: /PROJ-1/ })).toBeVisible();
  const config = page.getByRole("region", { name: "Cấu hình repo" });
  await expect(config.getByText("2 dòng")).toBeVisible();
  await expect(config.getByText(/docs/)).toBeVisible();

  await recent.getByRole("link", { name: /PROJ-1/ }).click();
  await expect(page).toHaveURL(/#\/tasks\/PROJ-1/);
});

test("the usage popover explains when no agent reported usage yet", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: /Hạn mức/ }).click();
  await expect(page.getByRole("dialog").getByText(/Chưa có số liệu/)).toBeVisible();
});
