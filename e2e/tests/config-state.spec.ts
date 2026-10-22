import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

const toolbar = (page: Page) => page.locator(".config-toolbar");
const nav = (page: Page) => page.getByRole("navigation", { name: "File của workflow" });

/**
 * The built-in workflow, shown as the repo's override at the network layer: tests share the fixture
 * repo, and writing its .taskpilot/ would change what workflow.spec.ts sees. Files differ from the default.
 */
async function withOverride(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/config/workflow",
    async (route) => {
      const config = (await (await route.fetch()).json()) as { origin: string; overrideKind: string; selected: string; mode: { id: string }; files: Record<string, unknown>[] };
      config.origin = "repo";
      config.overrideKind = "extends";
      config.selected = config.mode.id;
      for (const f of config.files) Object.assign(f, { sameAsDefault: false, provenance: "replaced" });
      await route.fulfill({ json: config });
    },
  );
  await page.route("**/api/config/workflow/default-diff?*", (route) => route.fulfill({ json: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n+khác mặc định\n", same: false } }));
  await page.goto("/#/workflow");
  await expect(page.getByText("Mặc định · override .taskpilot/")).toBeVisible();
}

test("the templates dialog loads the list again and ticks the new files again each time it opens", async ({ page }) => {
  let loads = 0;
  const templates = [
    { name: "taskpilot-explorer", rel: "taskpilot-explorer.md", description: "Mô tả explorer", path: ".claude/agents/taskpilot-explorer.md", exists: false, same: false, hash: "" },
    { name: "taskpilot-tester", rel: "taskpilot-tester.md", description: "Mô tả tester", path: ".claude/agents/taskpilot-tester.md", exists: true, same: false, hash: "hash-tester" },
  ];
  await page.route("**/api/config/agents/templates", (route) => {
    loads++;
    return route.fulfill({ json: templates });
  });
  await page.goto("/#/agents");
  await page.locator(".config-toolbar").getByRole("button", { name: "Subagent mẫu" }).click();

  const dialog = page.getByRole("dialog", { name: "Subagent mẫu của TaskPilot" });
  const explorer = dialog.getByRole("checkbox", { name: /taskpilot-explorer/ });
  const tester = dialog.getByRole("checkbox", { name: /taskpilot-tester/ });
  await expect(explorer).toBeChecked();
  await expect(tester).not.toBeChecked();
  expect(loads).toBe(1);

  // Change the ticks, close, open again: the list is fetched again and the defaults are back.
  await explorer.uncheck();
  await tester.check();
  await dialog.getByRole("button", { name: "Đóng" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator(".config-toolbar").getByRole("button", { name: "Subagent mẫu" }).click();
  await expect(dialog.getByRole("checkbox", { name: /taskpilot-explorer/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /taskpilot-tester/ })).not.toBeChecked();
  expect(loads).toBe(2);
});

test("cancelling the draft shows the result of the config again", async ({ page }) => {
  await withOverride(page);
  await page.route("**/api/config/workflow/validate", (route) => route.fulfill({ json: { errors: ["live draft error"], warnings: [] } }));
  await expect(page.locator(".wf-ok")).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("# ");
  await expect(page.locator(".check-error")).toHaveText("live draft error");

  await toolbar(page).getByRole("button", { name: "Huỷ", exact: true }).click();
  await toolbar(page).getByRole("button", { name: "Bỏ thay đổi" }).click();
  await expect(page.locator(".check-error")).toHaveCount(0);
  await expect(page.locator(".wf-ok")).toBeVisible();
});

test("the comparison with the default is hidden when another file is picked", async ({ page }) => {
  await withOverride(page);
  await nav(page)
    .getByRole("button", { name: /implement\.md/ })
    .click();
  await page.getByRole("button", { name: "So với mặc định" }).click();
  await expect(page.getByLabel("So với mặc định", { exact: true }).filter({ hasText: "khác mặc định" })).toBeVisible();
  await expect(page.locator(".wf-file .diff-view")).toBeVisible();

  await nav(page)
    .getByRole("button", { name: /investigate\.md/ })
    .click();
  await expect(page.locator(".wf-file .code-head")).toContainText("investigate.md");
  await expect(page.locator(".wf-file .diff-view")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "So với mặc định" })).toBeVisible();
});

test("a pending confirmation is dropped when another file is picked", async ({ page }) => {
  await withOverride(page);
  await toolbar(page).getByRole("button", { name: "Xoá override" }).click();
  await expect(toolbar(page).getByRole("button", { name: "Xác nhận xoá override" })).toBeVisible();

  await nav(page)
    .getByRole("button", { name: /implement\.md/ })
    .click();
  await expect(toolbar(page).getByRole("button", { name: "Xác nhận xoá override" })).toHaveCount(0);
  await expect(toolbar(page).getByRole("button", { name: "Xoá override" })).toBeVisible();
});

test("cancelling a new prompt goes back to workflow.yml", async ({ page }) => {
  await withOverride(page);
  await toolbar(page).getByRole("button", { name: "Thêm file prompt" }).click();
  await nav(page).getByRole("textbox").fill("review.md");
  await nav(page).getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".md-editor, .cm-content").first()).toBeVisible();

  await toolbar(page).getByRole("button", { name: "Huỷ", exact: true }).click();
  await toolbar(page).getByRole("button", { name: "Bỏ thay đổi" }).click();
  await expect(nav(page).getByRole("button", { name: /review\.md/ })).toHaveCount(0);
  await expect(page.locator(".wf-file .code-head")).toContainText("workflow.yml");
});
