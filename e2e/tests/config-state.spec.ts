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
  await page.route(
    (url) => url.pathname === "/api/config/agents/templates",
    (route) => {
      loads++;
      return route.fulfill({ json: templates });
    },
  );
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

test("instruction drafts use the selected CLI and never preview another CLI's file", async ({ page }) => {
  const expected = { claude: "CLAUDE.md", copilot: ".github/copilot-instructions.md", codex: "AGENTS.md" } as const;
  for (const [cli, path] of Object.entries(expected)) {
    const rawResponse = await page.request.get(`/api/config/memory/project/raw?cli=${cli}`);
    expect(rawResponse.ok()).toBe(true);
    const raw = (await rawResponse.json()) as { hash: string; content: string; path: string };
    expect(raw.path).toBe(path);
    const previewResponse = await page.request.post(`/api/config/memory/project/preview?cli=${cli}`, {
      data: { baseHash: raw.hash, content: `${raw.content}\n# Draft ${cli}\n` },
    });
    expect(previewResponse.ok()).toBe(true);
    const preview = (await previewResponse.json()) as { diff: string; changed: boolean; stale: boolean };
    expect(preview).toMatchObject({ changed: true, stale: false });
    expect(preview.diff).toContain(path);
    expect(preview.diff).toContain(`Draft ${cli}`);
  }
  const claude = (await (await page.request.get("/api/config/memory/project/raw")).json()) as { content: string };
  expect(claude.content).not.toContain("Draft ");
});

test("switching CLI drops a pending preview and restores only that provider's draft", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  const previews: string[] = [];
  const saves: string[] = [];
  await page.route("**/api/config/memory/project/preview?*", async (route) => {
    previews.push(new URL(route.request().url()).searchParams.get("cli")!);
    if (previews.length === 1) { requested = true; await pending; }
    await route.fulfill({ json: { diff: "--- CLAUDE.md\n+++ CLAUDE.md\n@@ -0,0 +1 @@\n+draft claude", changed: true, stale: false } });
  });
  await page.route("**/api/config/memory/project?*", (route) => {
    saves.push(new URL(route.request().url()).searchParams.get("cli")!);
    return route.fulfill({ json: { hash: "saved", backup: {} } });
  });
  await page.goto("/#/memory");
  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").fill("# draft claude");
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(() => { location.hash = "#/memory?cli=codex"; });
  await expect(page.locator(".code-head")).toContainText("AGENTS.md");
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.evaluate(() => { location.hash = "#/memory"; });
  await expect(page.locator(".cm-content")).toContainText("draft claude");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("draft claude");
  await dialog.getByRole("button", { name: "Lưu file", exact: true }).click();
  await expect.poll(() => saves).toEqual(["claude"]);
  expect(previews).toEqual(["claude", "claude"]);
});

test("an editor-opening response from the previous CLI cannot create a draft after switching", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  let returned = false;
  await page.route("**/api/config/memory/project/raw?cli=claude", async (route) => {
    const response = await route.fetch();
    requested = true;
    await pending;
    await route.fulfill({ response });
    returned = true;
  });
  await page.goto("/#/memory");
  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(() => { location.hash = "#/memory?cli=copilot"; });
  await expect(page.locator(".code-head")).toContainText("copilot-instructions.md");
  release();
  await expect.poll(() => returned).toBe(true);
  await page.evaluate(() => { location.hash = "#/memory"; });
  await expect(toolbar(page).getByRole("button", { name: "Sửa", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
});

for (const [cli, extension, directory] of [["claude", ".md", ".claude/agents"], ["copilot", ".agent.md", ".github/agents"], ["codex", ".toml", ".codex/agents"]] as const) {
  test(`${cli} library creates and saves its native template in the selected provider`, async ({ page }) => {
    const rel = `adapter-regression${extension}`;
    const path = `${directory}/${rel}`;
    let previewBody: { content: string; rel: string; baseHash: string } | undefined;
    let saved = false;
    await page.route(`**/api/config/library/agents/project/raw?cli=${cli}&*`, (route) => route.fulfill({ json: { path, content: "", hash: "empty-native", exists: false } }));
    await page.route(`**/api/config/library/agents/project/preview?cli=${cli}`, async (route) => {
      previewBody = route.request().postDataJSON();
      await route.fulfill({ json: { diff: `--- ${path}\n+++ ${path}\n@@ -0,0 +1 @@\n+native template`, changed: true, stale: false } });
    });
    await page.route(`**/api/config/library/agents/project?cli=${cli}`, async (route) => {
      expect(route.request().postDataJSON()).toEqual(previewBody);
      saved = true;
      await route.fulfill({ json: { hash: "saved", backup: {} } });
    });
    await page.goto(`/#/agents?cli=${cli}`);
    await toolbar(page).getByRole("button", { name: "Thêm", exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("adapter-regression");
    await page.getByRole("dialog").getByRole("button", { name: "Tạo và mở editor", exact: true }).click();
    await expect(page.locator(".lib-editor h2")).toHaveText(path);
    await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("native template");
    expect(previewBody).toMatchObject({ rel, baseHash: "empty-native" });
    expect(previewBody!.content).toContain(cli === "codex" ? 'developer_instructions = ' : "---\n");
    expect(previewBody!.content.includes("model: sonnet")).toBe(cli === "claude");
    await dialog.getByRole("button", { name: "Tạo file", exact: true }).click();
    await expect.poll(() => saved).toBe(true);
  });
}
