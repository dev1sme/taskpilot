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
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
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
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.locator(".hooks-editor")).toBeVisible();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".hooks-editor")).toHaveCount(0);
});

test("hooks tab of a file without hooks offers to add one", async ({ page }) => {
  await page.goto("/#/hooks");
  await page.getByRole("tab", { name: ".claude/settings.local.json" }).click();
  await expect(page.getByText(".claude/settings.local.json chưa có hook nào")).toBeVisible();
  await page.locator(".config-toolbar").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".hook-row")).toHaveCount(1);
  // The empty starter row alone is not an unsaved change.
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
});

test("agents show one tab per folder and mark the agent another scope hides", async ({ page }) => {
  await page.goto("/#/agents");
  const tabs = page.getByRole("tablist", { name: "Thư mục agents" });
  await expect(tabs.getByRole("tab", { name: ".claude/agents (1)", exact: true })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "~/.claude/agents (1)", exact: true })).toBeVisible();
  const list = page.locator(".library-list");
  await expect(list.locator(".lib-item")).toHaveCount(1);
  await expect(list.getByText("Review của repo")).toBeVisible();
  await expect(list.locator(".shadow-pill")).toHaveCount(0);

  await tabs.getByRole("tab", { name: "~/.claude/agents" }).click();
  await expect(list.getByText("Review của ba")).toBeVisible();
  await expect(list.getByText("Review của repo")).toHaveCount(0);
  await expect(list.locator(".shadow-pill")).toHaveText("Bị Project che");
  await expect(page.locator(".library-detail .alert-warn")).toContainText("scope Project được ưu tiên");
});

test("new item goes to the folder of the open tab", async ({ page }) => {
  await page.goto("/#/commands");
  await page.getByRole("tablist", { name: "Thư mục commands" }).getByRole("tab", { name: "~/.claude/commands" }).click();
  await expect(page.getByRole("heading", { name: "Chưa có command trong ~/.claude/commands" })).toBeVisible();
  await page.locator(".toolbar").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("~/.claude/commands (mọi repo)")).toBeVisible();
});

test("mcp shows three scope tabs and marks the server a local one hides", async ({ page }) => {
  await page.goto("/#/mcp");
  const tabs = page.getByRole("tablist", { name: "File MCP" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  const list = page.locator(".mcp-list");
  await expect(list.locator(".mcp-item")).toHaveCount(1);
  await expect(list.locator(".shadow-pill")).toHaveText("Bị Local che");
  await expect(page.getByText("Trùng tên: Local > Project > User.")).toBeVisible();

  await tabs.getByRole("tab", { name: "~/.claude.json · repo này" }).click();
  await expect(list.locator(".shadow-pill")).toHaveCount(0);
  await expect(page.locator(".library-detail .lib-path")).toHaveText(/claude\.json/);

  await tabs.getByRole("tab", { name: "~/.claude.json (0)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chưa có MCP server trong ~/.claude.json" })).toBeVisible();
});
