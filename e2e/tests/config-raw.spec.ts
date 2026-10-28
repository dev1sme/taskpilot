import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

const SETTINGS = path.join(FIXTURE_REPO, ".claude/settings.json");

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

async function replaceEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
}

test("the UI view only shows settings; nothing in it edits the file", async ({ page }) => {
  await page.goto("/#/config/settings?cli=claude");
  await expect(page.getByText("Bash(npm test:*)")).toBeVisible();
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("checkbox")).toHaveCount(0);
});

test("raw: save shows the diff, writes the file and keeps a backup", async ({ page }) => {
  await page.goto("/#/config/settings?cli=claude&view=raw&scope=project");
  await expect(page.locator(".cm-content").first()).toContainText("npm test");
  const next = JSON.stringify({ permissions: { allow: ["Bash(npm run lint:*)"] } }, null, 2) + "\n";
  await replaceEditor(page, next);
  await page.getByRole("button", { name: "Lưu…" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText('+    "Bash(npm run lint:*)"')).toBeVisible();
  await dialog.getByRole("button", { name: "Ghi file" }).click();
  await expect(dialog).toBeHidden();
  expect(readFileSync(SETTINGS, "utf8")).toBe(next);

  await page.goto("/#/backups");
  await expect(page.getByRole("button", { name: /\.claude\/settings\.json/ }).first()).toBeVisible();
});

test("raw: a syntax error is refused and the file stays as it was", async ({ page }) => {
  const before = readFileSync(SETTINGS, "utf8");
  await page.goto("/#/config/settings?cli=claude&view=raw&scope=project");
  await expect(page.locator(".cm-content").first()).toContainText("npm test");
  await replaceEditor(page, '{ "permissions": ');
  await page.getByRole("button", { name: "Lưu…" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(readFileSync(SETTINGS, "utf8")).toBe(before);
});
