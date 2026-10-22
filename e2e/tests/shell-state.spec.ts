import { expect, test } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

const OTHER_REPO = `${FIXTURE_REPO}-other`;
const NO_REPO = { path: null, tasksDir: null, tasksDirExists: false };

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test.describe("drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stays closed after the screen grows past the breakpoint and shrinks again", async ({ page }) => {
    await page.goto("/#/tasks");
    const sidebar = page.locator("nav.sidebar");
    await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
    await expect(sidebar).toBeVisible();

    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator(".mobile-bar")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".mobile-bar")).toBeVisible();
    await expect(sidebar).toBeHidden();
  });
});

test.describe("repo dialog", () => {
  test("opens by itself when the repo has no path, and closes", async ({ page }) => {
    await page.route("**/api/repo", (route) => (route.request().method() === "GET" ? route.fulfill({ json: NO_REPO }) : route.fallback()));
    await page.goto("/#/");
    const dialog = page.getByRole("dialog", { name: "Mở repo" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("does not open by itself when the repo has a path", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.locator(".repo-switch .repo-path")).toHaveText(FIXTURE_REPO);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the path field shows the open repo, and the new one after a switch", async ({ page }) => {
    let current = FIXTURE_REPO;
    await page.route("**/api/repo", async (route) => {
      const req = route.request();
      if (req.method() === "PUT") current = (req.postDataJSON() as { path: string }).path;
      else if (req.method() !== "GET") return route.fallback();
      const res = await route.fetch({ method: "GET", postData: undefined });
      await route.fulfill({ response: res, json: { ...(await res.json()), path: current } });
    });
    await page.goto("/#/");
    await page.locator(".repo-switch").click();
    const dialog = page.getByRole("dialog", { name: "Mở repo" });
    const field = dialog.getByLabel("Đường dẫn repo");
    await expect(field).toHaveValue(FIXTURE_REPO);
    await expect(field).toBeFocused();

    await field.fill(OTHER_REPO);
    await dialog.getByRole("button", { name: "Mở repo" }).click();
    await expect(dialog).toHaveCount(0);

    await page.locator(".repo-switch").click();
    await expect(dialog.getByLabel("Đường dẫn repo")).toHaveValue(OTHER_REPO);
  });
});

test.describe("command palette", () => {
  test("opens empty with the first entry selected, and gives focus back on close", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.locator("main h1")).toBeVisible();
    const toolbarButton = page.locator(".search-trigger");
    await toolbarButton.focus();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Tìm nhanh" });
    const input = palette.getByRole("combobox");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

    // Typing narrows the list and selects its first entry, even after moving down.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(palette.getByRole("option").nth(2)).toHaveAttribute("aria-selected", "true");
    await input.fill("hooks");
    await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expect(palette.getByRole("option").first()).toContainText("Hooks");

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(toolbarButton).toBeFocused();

    // Reopening starts clean: no old query, first entry selected.
    await page.keyboard.press("Control+k");
    await expect(input).toHaveValue("");
    await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expect(palette.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "false");
  });

  test("reopening forgets the selection moved with the arrow keys", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.locator("main h1")).toBeVisible();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Tìm nhanh" });
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(palette.getByRole("option").nth(2)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  });
});
