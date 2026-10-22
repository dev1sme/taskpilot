import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

/** A second repo the app is told it switched to; nothing exists there, the server never opens it. */
const OTHER_REPO = `${FIXTURE_REPO}-other`;

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
  await fakeRepoSwitch(page);
});

/**
 * The open repo is shared by every test of the run (the server keeps one), so switching is faked:
 * `GET`/`PUT /api/repo` answer with the path last asked for, and every other API still reads the fixture.
 */
async function fakeRepoSwitch(page: Page): Promise<void> {
  let current = FIXTURE_REPO;
  await page.route("**/api/repo", async (route) => {
    const req = route.request();
    if (req.method() === "PUT") current = (req.postDataJSON() as { path: string }).path;
    else if (req.method() !== "GET") return route.fallback();
    const res = await route.fetch({ method: "GET", postData: undefined });
    await route.fulfill({ response: res, json: { ...(await res.json()), path: current } });
  });
}

/** The args textarea has `path` on a line of its own. */
const argLine = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");

async function switchRepo(page: Page, path: string): Promise<void> {
  await page.locator(".repo-switch").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Đường dẫn repo").fill(path);
  await dialog.getByRole("button", { name: "Mở repo" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".repo-switch .repo-path")).toHaveText(path);
}

test("a draft stays with the repo it was made in", async ({ page }) => {
  await page.goto("/#/agents");
  await page.locator(".toolbar").getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Tên").fill("draft-agent");
  await page.getByRole("dialog").getByRole("button", { name: "Tạo và mở editor" }).click();
  const editor = page.locator(".lib-editor");
  await expect(editor).toContainText("draft-agent.md");

  // The other repo has no such draft: the page shows its list, not the editor.
  await switchRepo(page, OTHER_REPO);
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".toolbar").getByRole("button", { name: "Thêm", exact: true })).toBeVisible();

  // Back in the first repo the draft is still there.
  await switchRepo(page, FIXTURE_REPO);
  await expect(editor).toContainText("draft-agent.md");
});

test("an open add-MCP form closes when the repo changes", async ({ page }) => {
  await page.route("**/api/config/codegraph", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { supported: true, indexed: false, detail: null, summary: null, error: null } }) : route.fallback(),
  );
  await page.goto("/#/codegraph");
  const add = page.getByRole("button", { name: "Thêm", exact: true });
  await add.click();
  const form = page.locator(".mcp-form");
  await expect(form.getByLabel("Tham số")).toHaveValue(argLine(FIXTURE_REPO));

  // The form was filled for the old repo: it must not stay open with that path.
  await switchRepo(page, OTHER_REPO);
  await expect(form).toHaveCount(0);

  // Opening it again uses the repo now open.
  await add.click();
  await expect(form.getByLabel("Tham số")).toHaveValue(argLine(OTHER_REPO));
});
