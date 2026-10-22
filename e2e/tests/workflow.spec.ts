import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

// The override and the repo's mode (.taskpilot/settings.yml) live in the shared fixture repo: run these one at a time and leave nothing behind.
test.describe.configure({ mode: "serial" });

const OVERRIDE = path.join(FIXTURE_REPO, ".taskpilot");
const clean = () => rmSync(OVERRIDE, { recursive: true, force: true });

test.beforeEach(async ({ page }) => {
  clean();
  await openFixtureRepo(page);
  // The repo's default mode is kept in .taskpilot/settings.yml: start from the default.
  await page.request.put("/api/config/workflow/mode", { data: { mode: "default" } });
});
test.afterAll(clean);

async function withOverride(page: Page) {
  expect((await page.request.post("/api/config/workflow/override", { data: { mode: "default" } })).ok()).toBe(true);
  await page.goto("/#/workflow");
  await expect(page.getByText("Mặc định · override .taskpilot/")).toBeVisible();
}

const toolbar = (page: Page) => page.locator(".config-toolbar");

test("the built-in workflow is read only; the mode is chosen without an override", async ({ page }) => {
  await page.goto("/#/workflow");
  await expect(page.getByText("Mặc định · có sẵn của TaskPilot", { exact: true })).toBeVisible();
  await expect(toolbar(page).getByText("Chỉ xem")).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  // The guide is open while the repo has no override.
  const guide = page.locator(".wf-guide");
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide).toContainText("Khi nào có hiệu lực:");
  const nav = page.getByRole("navigation", { name: "File của workflow" });
  await expect(nav).toContainText("Điều tra & lên kế hoạch");
  await expect(nav).toContainText("01-investigation.md, 02-plan.md ✓");
  // Skeletons sit in their own group, not inside the steps.
  await expect(nav.getByRole("button", { name: /format-plan\.md/ })).toContainText("02-plan.md");
  await nav.getByRole("button", { name: /investigate\.md/ }).click();
  await expect(page.locator(".wf-file .code-lines")).toContainText("{{outputs}}");

  // Another mode is looked at, and made the repo's, with no override.
  const modes = page.getByRole("tablist", { name: "Xem từng cách chạy" });
  await modes.getByRole("tab", { name: /Leader/ }).click();
  await expect(page.getByText("Leader · có sẵn của TaskPilot", { exact: true })).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Dùng làm mặc định của repo" }).click();
  await expect(modes.getByRole("tab", { name: /Leader/ })).toContainText("mặc định của repo");
  // The choice is the repo's settings.yml; there is still no override.
  expect(readFileSync(path.join(OVERRIDE, "settings.yml"), "utf8")).toContain("mode: leader");
  expect(existsSync(path.join(OVERRIDE, "workflow.yml"))).toBe(false);
});

test("an override is only what differs: one file, applied to its own mode", async ({ page }) => {
  await page.goto("/#/workflow");
  await toolbar(page).getByRole("button", { name: "Tạo override dựa trên Mặc định" }).click();
  await expect(page.getByText("Mặc định · override .taskpilot/")).toBeVisible();
  expect(readFileSync(path.join(OVERRIDE, "workflow.yml"), "utf8")).toContain("extends: default");
  expect(existsSync(path.join(OVERRIDE, "investigate.md"))).toBe(false);
  await expect(page.getByRole("navigation", { name: "File của workflow" })).toContainText("có sẵn");

  // Another mode runs as shipped, and says the override is not part of it.
  await page
    .getByRole("tablist", { name: "Xem từng cách chạy" })
    .getByRole("tab", { name: /Leader/ })
    .click();
  await expect(page.getByText("không áp dụng cho cách chạy này")).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: /Tạo override/ })).toHaveCount(0);
});

test("workflow.yml of an override is edited as YAML, checked live and saved", async ({ page }) => {
  await withOverride(page);
  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("extends: default\nsteps: [{id: implement, title: Làm cho xong}]\n");
  await expect(page.getByText("Chưa lưu").first()).toBeVisible();
  await expect(page.locator(".wf-ok")).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await expect(page.getByRole("dialog")).toContainText("Làm cho xong");
  await page.getByRole("button", { name: "Lưu file" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(readFileSync(path.join(OVERRIDE, "workflow.yml"), "utf8")).toContain("title: Làm cho xong");
  await expect(page.getByRole("navigation", { name: "File của workflow" })).toContainText("đã sửa: title");
});

test("a prompt is replaced by a file of the same name, then the override is removed", async ({ page }) => {
  await withOverride(page);
  const nav = page.getByRole("navigation", { name: "File của workflow" });
  await toolbar(page).getByRole("button", { name: "Thêm file prompt" }).click();
  await nav.getByRole("textbox").fill("implement.md");
  await nav.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nExtra rule: ");
  await page.getByRole("button", { name: "{{historyFile}}" }).click();
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await page.getByRole("button", { name: "Tạo file" }).click();
  await expect(nav.getByRole("button", { name: /implement\.md/ })).toContainText("thay file có sẵn");
  expect(readFileSync(path.join(OVERRIDE, "implement.md"), "utf8")).toContain("Extra rule: {{historyFile}}");

  await toolbar(page).getByRole("button", { name: "Xoá override" }).click();
  await toolbar(page).getByRole("button", { name: "Xác nhận xoá override" }).click();
  await expect(page.getByText("Mặc định · có sẵn của TaskPilot", { exact: true })).toBeVisible();
  // Only the override goes; the repo's mode (settings.yml) stays.
  expect(existsSync(path.join(OVERRIDE, "workflow.yml"))).toBe(false);
  expect(existsSync(path.join(OVERRIDE, "implement.md"))).toBe(false);
  expect(existsSync(path.join(OVERRIDE, "settings.yml"))).toBe(true);
});

test("a complete override of the old format is offered a move to `extends`", async ({ page }) => {
  // A legacy override: the built-in default's files, copied whole.
  const files = (await (await page.request.get("/api/config/workflow")).json()).resolved as Record<string, string>;
  mkdirSync(OVERRIDE, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(OVERRIDE, name), content);
  await page.goto("/#/workflow");
  await page.getByRole("tab", { name: "Override của repo (toàn bộ)" }).click();
  await expect(page.getByText("Override dạng cũ (đủ bộ file)")).toBeVisible();
  await page.getByRole("button", { name: "Chuyển sang dạng extends" }).click();
  await expect(page.getByRole("dialog")).toContainText("extends");
  await page.getByRole("button", { name: "Chuyển", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(readFileSync(path.join(OVERRIDE, "workflow.yml"), "utf8")).toContain("extends: default");
  expect(existsSync(path.join(OVERRIDE, "investigate.md"))).toBe(false);
});

test("the documents page shows each step's documents with their skeletons and links to the editor", async ({ page }) => {
  await page.goto("/#/formats");
  const plan = page.locator(".fmt-card").filter({ hasText: "02-plan.md" }).first();
  await expect(plan).toContainText("Khung: format-plan.md");
  await expect(plan).toContainText("bước xong khi Claude ghi file này");
  await expect(plan.locator(".fmt-rendered h2").first()).toHaveText("1. Mục tiêu");
  // Hints stay visible once rendered.
  await expect(plan.locator(".fmt-rendered blockquote").first()).toContainText("Kết quả cần đạt");
  await plan.getByRole("tab", { name: "Nguồn" }).click();
  await expect(plan.locator(".fmt-raw")).toContainText("<!-- Kết quả cần đạt");
  await expect(page.getByRole("region", { name: "Nhật ký quyết định" })).toContainText("format-history.md");
  // The built-in workflow is read only: no edit button until the repo has an override of that file.
  await expect(plan.getByRole("button", { name: "Sửa" })).toHaveCount(0);

  // An `extends` override keeps showing the mode's skeletons, and edits only the ones it holds.
  expect((await page.request.post("/api/config/workflow/override", { data: { mode: "default" } })).ok()).toBe(true);
  const planFile = (await (await page.request.get("/api/config/workflow")).json()).resolved["format-plan.md"] as string;
  expect((await page.request.put("/api/config/workflow/file", { data: { name: "format-plan.md", content: planFile, baseHash: "absent" } })).ok()).toBe(true);
  await page.reload();
  const card = page.locator(".fmt-card").filter({ hasText: "02-plan.md" }).first();
  await expect(card.locator(".fmt-rendered h2").first()).toHaveText("1. Mục tiêu");
  await card.getByRole("button", { name: "Sửa" }).click();
  await expect(page).toHaveURL(/#\/workflow\/format-plan\.md$/);
  await expect(page.locator(".wf-file .code-head")).toContainText(".taskpilot/format-plan.md");
});
