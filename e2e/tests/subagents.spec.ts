import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

const template = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  rel: `${name}.md`,
  description: `Mô tả ${name}`,
  path: `.claude/agents/${name}.md`,
  exists: false,
  same: false,
  hash: "",
  ...extra,
});

/**
 * Templates are faked at the network layer: tests share the fixture repo, and writing to its
 * .claude/agents would change what the other tests see. The server side is covered in library.test.ts.
 */
async function fakeTemplates(page: Page, templates: ReturnType<typeof template>[]) {
  const installs: unknown[] = [];
  await page.route("**/api/config/agents/templates", (route) => route.fulfill({ json: templates }));
  await page.route("**/api/config/agents/templates/preview", (route) =>
    route.fulfill({
      json: {
        files: templates.map((x) => ({ ...x, hash: x.exists ? `hash-${x.name}` : x.hash })),
        diff: "--- a\n+++ b\n@@ -0,0 +1 @@\n+name: taskpilot-explorer\n",
      },
    }),
  );
  await page.route("**/api/config/agents/templates/install", (route) => {
    const body = route.request().postDataJSON() as { names: string[] };
    installs.push(body);
    return route.fulfill({ json: { files: body.names.map((n) => `.claude/agents/${n}.md`), skipped: [] } });
  });
  return installs;
}

test("each agent shows whether a TaskPilot workflow can use it", async ({ page }) => {
  await page.goto("/#/agents");
  const list = page.locator(".library-list");
  await expect(list.locator(".check-pill")).toHaveText("leader · member");
  const check = page.getByRole("region", { name: "Kiểm tra cho TaskPilot" });
  await expect(check).toContainText("Vai trò: leader (leader gọi qua Task tool), member (chạy cả một việc con).");
  // A repo agent is there, so no banner.
  await expect(page.getByRole("region", { name: "Repo chưa có subagent" })).toHaveCount(0);

  await page.getByRole("tablist", { name: "Thư mục agents" }).getByRole("tab", { name: "~/.claude/agents" }).click();
  await expect(list.locator(".check-pill")).toHaveText("không dùng được");
  await expect(check).toContainText("Không giao được cho leader hay việc con.");
});

test("a repo without subagents offers TaskPilot's templates, written after the diff", async ({ page }) => {
  await page.route("**/api/config/agents", (route) => route.fulfill({ json: [] }));
  const installs = await fakeTemplates(page, [template("taskpilot-explorer"), template("taskpilot-implementer")]);
  await page.goto("/#/agents");
  const banner = page.getByRole("region", { name: "Repo chưa có subagent" });
  await banner.getByRole("button", { name: "Ghi subagent mẫu của TaskPilot" }).click();

  const dialog = page.getByRole("dialog", { name: "Subagent mẫu của TaskPilot" });
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);
  await expect(dialog.getByText("Chưa có, sẽ tạo .claude/agents/taskpilot-explorer.md")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /taskpilot-implementer/ }).uncheck();
  await dialog.getByRole("button", { name: "Xem diff (1 file)" }).click();

  const diff = page.getByRole("dialog", { name: "Ghi subagent mẫu vào .claude/agents" });
  await expect(diff).toContainText("+name: taskpilot-explorer");
  await diff.getByRole("button", { name: "Ghi 1 file" }).click();
  await expect.poll(() => installs).toEqual([{ names: ["taskpilot-explorer"], overwrite: [], hashes: { "taskpilot-explorer": "", "taskpilot-implementer": "" } }]);
  await expect(page.getByText("Đã ghi 1 subagent mẫu vào .claude/agents.")).toBeVisible();
});

test("a template the repo changed is overwritten only when ticked, with the hash the diff showed", async ({ page }) => {
  const installs = await fakeTemplates(page, [
    template("taskpilot-explorer", { exists: true, same: true, hash: "hash-taskpilot-explorer" }),
    template("taskpilot-tester", { exists: true, hash: "hash-taskpilot-tester" }),
  ]);
  await page.goto("/#/agents");
  await page.locator(".config-toolbar").getByRole("button", { name: "Subagent mẫu" }).click();

  const dialog = page.getByRole("dialog", { name: "Subagent mẫu của TaskPilot" });
  await expect(dialog.getByRole("checkbox", { name: /taskpilot-explorer/ })).toBeDisabled();
  await expect(dialog.getByText("Repo đã có, giống bản mẫu")).toBeVisible();
  const tester = dialog.getByRole("checkbox", { name: /taskpilot-tester/ });
  await expect(tester).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Xem diff (0 file)" })).toBeDisabled();
  await tester.check();
  await dialog.getByRole("button", { name: "Xem diff (1 file)" }).click();
  await page.getByRole("dialog", { name: "Ghi subagent mẫu vào .claude/agents" }).getByRole("button", { name: "Ghi 1 file" }).click();
  await expect
    .poll(() => installs)
    .toEqual([{ names: ["taskpilot-tester"], overwrite: ["taskpilot-tester"], hashes: { "taskpilot-explorer": "hash-taskpilot-explorer", "taskpilot-tester": "hash-taskpilot-tester" } }]);
});
