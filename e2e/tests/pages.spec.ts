import { expect, test } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

// Every route but the start page loads on first visit: each must render its heading.
for (const [hash, heading] of [
  ["#/tasks", "Task"],
  ["#/tasks/PROJ-1", "Thêm trang đăng nhập bằng OAuth"],
  ["#/config/memory?cli=claude", "Hướng dẫn"],
  ["#/config/settings?cli=claude", "Settings & quyền"],
  ["#/config/hooks?cli=claude", "Hooks"],
  ["#/config/agents?cli=claude", "Thư viện"],
  ["#/config/mcp?cli=claude", "MCP servers"],
  ["#/config/workflow", "Workflow"],
  ["#/config/codegraph", "Codegraph"],
  ["#/backups", "Lịch sử thay đổi"],
] as const) {
  test(`${hash} renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    expect(errors).toEqual([]);
  });
}

test("overview lists the repo's open task and its configuration", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("fixture-repo");
  await expect(page.getByRole("main").getByText(FIXTURE_REPO)).toBeVisible();
  const recent = page.getByRole("region", { name: "Đang làm dở" });
  await expect(recent.getByRole("link", { name: /PROJ-1/ })).toBeVisible();
  const config = page.getByRole("region", { name: "Cấu hình repo" });
  await expect(config.getByText("3 dòng")).toBeVisible();
  await expect(config.getByText("docs", { exact: true })).toHaveCount(2);

  await recent.getByRole("link", { name: /PROJ-1/ }).click();
  await expect(page).toHaveURL(/#\/tasks\/PROJ-1/);
});

test("the usage popover explains when no agent reported usage yet", async ({ page }) => {
  await page.goto("/#/");
  await page.getByRole("button", { name: /Hạn mức/ }).click();
  await expect(page.getByRole("dialog").getByText(/Chưa có số liệu/)).toBeVisible();
});

test("overview stays within its scroll container on narrow screens with long task content", async ({ page }) => {
  await page.route("**/api/tasks", async (route) => {
    const response = await route.fetch();
    const tasks = await response.json();
    await route.fulfill({
      json: tasks.map((task: Record<string, unknown>) => ({ ...task, key: "TASK-".repeat(24), title: "apps/server/src/" + "long_path_segment_".repeat(20), waitingPermission: true })),
    });
  });
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    await expect(page.getByRole("region", { name: "Cần ba xử lý" }).getByRole("link")).toBeVisible();
    const main = page.getByRole("main");
    await expect.poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await main.evaluate((element) => {
      element.scrollLeft = 100;
    });
    await expect.poll(() => main.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
});

test("overview switches native configuration between all three providers", async ({ page }) => {
  await page.goto("/#/");
  const config = page.getByRole("region", { name: "Cấu hình repo" });
  for (const [provider, cli] of [
    ["Claude", "claude"],
    ["Copilot", "copilot"],
    ["Codex", "codex"],
  ] as const) {
    await config.getByRole("tab", { name: provider, exact: true }).click();
    const panel = config.getByRole("tabpanel");
    await expect(panel.getByRole("link", { name: "Hướng dẫn", exact: true })).toHaveAttribute("href", new RegExp(`cli=${cli}`));
    await expect(panel.getByRole("link", { name: "MCP servers", exact: true })).toHaveAttribute("href", new RegExp(`cli=${cli}`));
    await expect(panel.getByRole("link", { name: "Settings & quyền", exact: true })).toHaveAttribute("href", new RegExp(`cli=${cli}`));
    await expect(panel.getByRole("alert")).toHaveCount(0);
    if (cli !== "claude") await expect(panel.getByRole("link", { name: "Commands", exact: true })).toHaveCount(0);
  }
  await config.getByRole("tabpanel").getByRole("link", { name: "MCP servers", exact: true }).click();
  await expect(page).toHaveURL(/config\/mcp\?cli=codex/);
  await page.goto("/#/");
  await expect(page.getByRole("region", { name: "Cấu hình repo" }).getByRole("tab", { name: "Codex", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("CLI versions are available from the status bar on desktop and mobile", async ({ page }) => {
  await page.route("**/api/info", (route) => route.fulfill({ json: { claudeVersion: "1.2.3", versions: { claude: "1.2.3", copilot: "2.3.4", codex: null } } }));
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/");
    const trigger = page.getByRole("contentinfo").getByRole("button", { name: "Phiên bản CLI", exact: true });
    await trigger.click();
    const info = page.getByRole("dialog", { name: "Phiên bản CLI", exact: true });
    await expect(info.getByText("1.2.3", { exact: true })).toBeVisible();
    await expect(info.getByText("2.3.4", { exact: true })).toBeVisible();
    await expect(info.getByText("Chưa cài đặt", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(info).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});

test("task filters match overview groups and completion actions only show icons", async ({ page }) => {
  await page.route("**/api/tasks", async (route) => {
    const response = await route.fetch();
    const [base] = await response.json();
    const run = (phase: string) => ({ phase, stepIndex: 0, stepStartedAt: Date.now() });
    await route.fulfill({
      json: [
        { ...base, key: "TPL-OPEN", run: null, done: null, waitingPermission: false },
        { ...base, key: "TPL-RUNNING", run: run("running"), done: null, waitingPermission: false },
        { ...base, key: "TPL-GATE", run: run("gate"), done: null, waitingPermission: false },
        { ...base, key: "TPL-PERMISSION", run: run("running"), done: null, waitingPermission: true },
        { ...base, key: "TPL-DONE", run: null, done: { at: Date.now() }, waitingPermission: false },
      ],
    });
  });
  await page.goto("/#/");
  const overview = page.getByRole("main");
  const counts = overview.locator("dl").first();
  await expect(counts.locator("dd")).toHaveText(["2", "1", "1", "1"]);
  await page.goto("/#/tasks");
  const filters = page.getByRole("radiogroup", { name: "Lọc task" });
  const cases = [
    ["Tất cả 5", ["TPL-GATE", "TPL-PERMISSION", "TPL-RUNNING", "TPL-OPEN", "TPL-DONE"]],
    ["Cần xử lý 2", ["TPL-GATE", "TPL-PERMISSION"]],
    ["Đang chạy 1", ["TPL-RUNNING"]],
    ["Đang làm 1", ["TPL-OPEN"]],
    ["Đã xong 1", ["TPL-DONE"]],
  ] as const;
  for (const [label, keys] of cases) {
    await filters.getByRole("radio", { name: label, exact: true }).click();
    const links = page.getByRole("table").getByRole("link");
    await expect(links).toHaveCount(keys.length);
    for (const key of keys) await expect(links.filter({ hasText: key })).toHaveCount(1);
  }
  await filters.getByRole("radio", { name: "Đang làm 1", exact: true }).click();
  const complete = page.getByRole("button", { name: "Đánh dấu TPL-OPEN hoàn thành", exact: true });
  await expect(complete).toBeEnabled();
  await expect(complete).toHaveText("");
  await complete.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Đánh dấu TPL-OPEN hoàn thành");
  await page.getByRole("searchbox", { name: "Tìm task" }).fill("không có task này");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(filters.getByRole("radio", { name: "Đang làm 0", exact: true })).toHaveAttribute("aria-checked", "true");
});
