import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

// The override lives in the shared fixture repo: run these one at a time and leave no override behind.
test.describe.configure({ mode: "serial" });

const OVERRIDE = path.join(FIXTURE_REPO, ".claude", "taskpilot");
const clean = () => rmSync(OVERRIDE, { recursive: true, force: true });

test.beforeEach(async ({ page }) => {
  clean();
  await openFixtureRepo(page);
});
test.afterAll(clean);

async function withOverride(page: Page) {
  expect((await page.request.post("/api/config/workflow/override")).ok()).toBe(true);
  await page.goto("/#/workflow");
  await expect(page.getByText("Override của repo · .claude/taskpilot/")).toBeVisible();
}

const toolbar = (page: Page) => page.locator(".config-toolbar");

test("the built-in workflow is read only until an override is added", async ({ page }) => {
  await page.goto("/#/workflow");
  await expect(page.getByText("Mặc định của TaskPilot", { exact: true })).toBeVisible();
  await expect(toolbar(page).getByText("Chỉ xem")).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "File của workflow" });
  await expect(nav).toContainText("Điều tra & lên kế hoạch");
  await expect(nav).toContainText("01-investigation.md, 02-plan.md ✓");
  await nav.getByRole("button", { name: /investigate\.md/ }).click();
  await expect(page.locator(".wf-file .code-lines")).toContainText("{{outputs}}");

  await toolbar(page).getByRole("button", { name: "Thêm config override" }).click();
  await expect(page.getByText("Override của repo · .claude/taskpilot/")).toBeVisible();
  expect(existsSync(path.join(OVERRIDE, "workflow.yml"))).toBe(true);
  expect(existsSync(path.join(OVERRIDE, "investigate.md"))).toBe(true);
  await expect(nav.getByRole("button", { name: /implement\.md/ })).toContainText("giống mặc định");
});

test("workflow.yml is edited in the form, previewed and checked before saving", async ({ page }) => {
  await withOverride(page);
  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();

  const plan = page.getByRole("textbox", { name: "Tên file" }).nth(1);
  await expect(plan).toHaveValue("02-plan.md");
  await plan.fill("02-ke-hoach.md");
  await expect(page.getByText("Chưa lưu").first()).toBeVisible();

  // The preview renders the unsaved draft.
  await page.getByRole("button", { name: "Xem prompt" }).click();
  await expect(page.locator(".wf-rendered")).toContainText(".claude/tasks/PROJ-1/02-ke-hoach.md");

  // A broken step id is reported live and refused at review.
  const id = page.getByRole("textbox", { name: "id", exact: true }).first();
  await id.fill("Bad Id");
  await expect(page.locator(".wf-checks-list")).toContainText("steps[0].id must match");
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await expect(page.getByRole("dialog")).toContainText("Workflow không hợp lệ");
  await page.getByRole("button", { name: "Tiếp tục sửa" }).click();

  await id.fill("investigate");
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await expect(page.getByRole("dialog")).toContainText("02-ke-hoach.md");
  await page.getByRole("button", { name: "Lưu file" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(readFileSync(path.join(OVERRIDE, "workflow.yml"), "utf8")).toContain("file: 02-ke-hoach.md");
  // Comments of the copied file survive the form.
  expect(readFileSync(path.join(OVERRIDE, "workflow.yml"), "utf8")).toContain("# Built-in TaskPilot workflow.");
});

test("a prompt is customized with variable chips, then the override is removed", async ({ page }) => {
  await withOverride(page);
  const nav = page.getByRole("navigation", { name: "File của workflow" });
  await nav.getByRole("button", { name: /implement\.md/ }).click();
  await toolbar(page).getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nExtra rule: ");
  await page.getByRole("button", { name: "{{historyFile}}" }).click();
  await toolbar(page).getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await page.getByRole("button", { name: "Lưu file" }).click();
  await expect(nav.getByRole("button", { name: /implement\.md/ })).toContainText("đã sửa");
  expect(readFileSync(path.join(OVERRIDE, "implement.md"), "utf8")).toContain("Extra rule: {{historyFile}}");

  await page.getByRole("button", { name: "So với mặc định" }).click();
  await expect(page.locator(".wf-file .diff-view")).toContainText("+Extra rule: {{historyFile}}");

  await toolbar(page).getByRole("button", { name: "Xoá override" }).click();
  await toolbar(page).getByRole("button", { name: "Xác nhận xoá override" }).click();
  await expect(page.getByText("Mặc định của TaskPilot", { exact: true })).toBeVisible();
  expect(existsSync(OVERRIDE)).toBe(false);
});
