import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TMP } from "../env";
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

test("memory Raw shows every file's existence before choosing a scope", async ({ page }) => {
  await page.goto("/#/config/memory?cli=claude&view=raw");
  const files = page.getByRole("radiogroup", { name: "File hướng dẫn theo phạm vi" });
  const project = files.getByRole("radio", { name: /^Project/ });
  const local = files.getByRole("radio", { name: /^Local/ });
  const global = files.getByRole("radio", { name: /^Global/ });
  await expect(project).toContainText("Đã có file");
  await expect(project).toContainText("CLAUDE.md");
  await expect(local).toContainText("Chưa có file");
  await expect(local).toContainText("CLAUDE.local.md");
  await expect(global).toContainText("Chưa có file");
  await expect(project).toHaveAttribute("aria-checked", "true");
  await local.click();
  await expect(local).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("File chưa có; lưu để tạo mới.")).toBeVisible();
  await project.click();
  await expect(page.locator(".cm-content").first()).toContainText("Fixture repo");
  await page.getByRole("link", { name: "Codex", exact: true }).click();
  await expect(files.getByRole("radio")).toHaveCount(2);
  await expect(files.getByRole("radio", { name: /^Project/ })).toContainText("AGENTS.md");
});

test("memory Raw initially selects an existing file and respects an explicit missing scope", async ({ page }) => {
  await page.route("**/api/config/memory?cli=claude", async (route) => {
    const response = await route.fetch();
    const files = await response.json();
    await route.fulfill({ json: files.map((file: { scope: string }) => ({ ...file, exists: file.scope === "user" })) });
  });
  await page.goto("/#/config/memory?cli=claude&view=raw");
  const files = page.getByRole("radiogroup", { name: "File hướng dẫn theo phạm vi" });
  await expect(files.getByRole("radio", { name: /^Global/ })).toHaveAttribute("aria-checked", "true");
  await page.goto("/#/config/memory?cli=claude&view=raw&scope=local");
  await expect(files.getByRole("radio", { name: /^Local/ })).toHaveAttribute("aria-checked", "true");
});

test("settings and Claude hooks show the files of all scopes before opening one", async ({ page }) => {
  for (const cli of ["claude", "copilot", "codex"]) {
    await page.goto(`/#/config/settings?cli=${cli}&view=raw`);
    const files = page.getByRole("radiogroup", { name: "File settings theo phạm vi" });
    const project = files.getByRole("radio", { name: /^Project/ });
    await expect(project).toContainText("Đã có file");
    await expect(project).toHaveAttribute("aria-checked", "true");
    const response = await page.request.get(`/api/config/settings?cli=${cli}`);
    const inventory = await response.json();
    const global = inventory.find((file: { scope: string }) => file.scope === "user");
    await expect(files.getByRole("radio", { name: /^Global/ })).toContainText(global.exists ? "Đã có file" : "Chưa có file");
    await expect(page.locator(".cm-content").first()).toBeVisible();
    await page.getByRole("tab", { name: "Giao diện", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sửa raw", exact: true })).toHaveCount(0);
  }
  await page.goto("/#/config/hooks?cli=claude&view=raw");
  const hooks = page.getByRole("radiogroup", { name: "File hooks theo phạm vi" });
  await expect(hooks.getByRole("radio", { name: /^Project/ })).toContainText(".claude/settings.json");
  await expect(hooks.getByRole("radio", { name: /^Project/ })).toContainText("Đã có file");
  const local = hooks.getByRole("radio", { name: /^Local/ });
  await expect(local).toContainText("Chưa có file");
  await local.click();
  await expect(page.getByText("File chưa có; lưu để tạo mới.")).toBeVisible();
});

test("Copilot hooks opens existing files and lets users name a new file", async ({ page }) => {
  await page.goto("/#/config/hooks?cli=copilot&view=raw");
  const scopes = page.getByRole("radiogroup", { name: "File hooks theo phạm vi" });
  await expect(scopes.getByRole("radio", { name: /^Project/ })).toContainText("fixture.json");
  await expect(scopes.getByRole("radio", { name: /^Project/ })).toContainText("1 file");
  await expect(page.getByRole("radiogroup", { name: "Chọn file hooks" }).getByRole("radio", { name: "fixture.json" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cm-content").first()).toContainText("preToolUse");
  await page.getByRole("button", { name: "Tạo file mới", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tên file", exact: true })).toHaveAttribute("placeholder", "hooks.json");
  await page.getByRole("textbox", { name: "Tên file", exact: true }).fill("new-hook.json");
  await page.getByRole("button", { name: "Mở", exact: true }).click();
  await expect(page.getByText("File chưa có; lưu để tạo mới.")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Chọn file hooks" }).getByRole("radio", { name: "fixture.json" }).click();
  await expect(page.locator(".cm-content").first()).toContainText("preToolUse");
  await scopes.getByRole("radio", { name: /^Global/ }).click();
  await expect(page.getByRole("textbox", { name: "Tên file", exact: true })).toBeVisible();
});

test("Codex hooks show hooks.json of each scope and save it as JSON", async ({ page }) => {
  await page.goto("/#/config/hooks?cli=codex");
  await expect(page.getByText("echo codex-fixture")).toBeVisible();
  await expect(page.getByText("/hooks").first()).toBeVisible();

  await page.goto("/#/config/hooks?cli=codex&view=raw");
  const scopes = page.getByRole("radiogroup", { name: "File hooks theo phạm vi" });
  await expect(scopes.getByRole("radio")).toHaveCount(2);
  await expect(scopes.getByRole("radio", { name: /^Project/ })).toContainText(".codex/hooks.json");
  await expect(scopes.getByRole("radio", { name: /^Project/ })).toHaveAttribute("aria-checked", "true");
  await expect(scopes.getByRole("radio", { name: /^Global/ })).toContainText("Chưa có file");
  await expect(page.locator(".cm-content").first()).toContainText("codex-fixture");

  const file = path.join(FIXTURE_REPO, ".codex/hooks.json");
  const before = readFileSync(file, "utf8");
  await replaceEditor(page, '{ "hooks": { "Stop": {} } }');
  await page.getByRole("button", { name: "Lưu…" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  expect(readFileSync(file, "utf8")).toBe(before);

  const next = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } }, null, 2) + "\n";
  await replaceEditor(page, next);
  await page.getByRole("button", { name: "Lưu…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ghi file" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(readFileSync(file, "utf8")).toBe(next);
});

test("Codex agents include personal agents from ~/.codex/agents", async ({ page }) => {
  const dir = path.join(TMP, "codex", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "personal-helper.toml"), 'name = "personal-helper"\ndescription = "Agent cá nhân"\ndeveloper_instructions = "Help."\n');
  await page.goto("/#/config/agents?cli=codex");
  await expect(page.getByText("personal-helper").first()).toBeVisible();
  await expect(page.getByText("native-reviewer").first()).toBeVisible();
  await page.goto("/#/config/agents?cli=codex&view=raw");
  await expect(page.getByRole("radiogroup", { name: "Phạm vi" }).getByRole("radio")).toHaveCount(2);
});
