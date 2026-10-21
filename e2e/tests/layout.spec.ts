import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ["/", "/tasks", "/tasks/PROJ-1", "/memory", "/settings", "/hooks", "/mcp"]) {
    test(`#${route} has no horizontal overflow`, async ({ page }) => {
      await page.goto(`/#${route}`);
      await expect(page.locator("main h1")).toBeVisible();
      const main = page.locator("main");
      const [scroll, client] = await main.evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    });
  }
});

// File actions live in the toolbar under the header; the header keeps only the search button.
for (const route of ["/memory", "/settings", "/hooks", "/mcp", "/agents"]) {
  test(`#${route} header has no buttons besides search`, async ({ page }) => {
    await page.goto(`/#${route}`);
    await expect(page.locator(".config-toolbar")).toBeVisible();
    await expect(page.locator(".page-header button:not(.search-trigger), .page-header a")).toHaveCount(0);
    await expect(page.locator(".config-toolbar").getByRole("button", { name: "Tải lại" })).toBeVisible();
  });
}

test("#/tasks/PROJ-1 header has no buttons besides search", async ({ page }) => {
  await page.goto("/#/tasks/PROJ-1");
  await expect(page.locator("main h1")).toContainText("PROJ-1");
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".page-header button:not(.search-trigger)")).toHaveCount(0);
});

test("CLAUDE.md edit actions stay in the toolbar while editing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/memory");
  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeVisible();
  await expect(page.locator(".page-header button:not(.search-trigger)")).toHaveCount(0);
  // Tabs and actions share one row at desktop width.
  const tab = await toolbar.getByRole("tab", { name: "CLAUDE.md", exact: true }).boundingBox();
  const save = await toolbar.getByRole("button", { name: "Xem thay đổi & lưu" }).boundingBox();
  expect(Math.abs(tab!.y + tab!.height / 2 - (save!.y + save!.height / 2))).toBeLessThan(8);
});

test("overview has no task list button", async ({ page }) => {
  await page.goto("/#/");
  await expect(page.locator("main h1")).toHaveText("Tổng quan");
  await expect(page.getByRole("link", { name: "Mở danh sách task" })).toHaveCount(0);
});

test("link styled as a button is not underlined", async ({ page }) => {
  await page.goto("/#/");
  // The fixture has no task waiting (the only .btn link on a page), so check the stylesheet on a stand-in.
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.className = "btn btn-attention";
    a.href = "#/tasks";
    a.textContent = "probe";
    a.id = "btn-link-probe";
    document.querySelector("main")!.append(a);
  });
  await expect(page.locator("#btn-link-probe")).toHaveCSS("text-decoration-line", "none");
});

// Wide code blocks, tables and long URLs in a skill stay inside the detail card.
for (const width of [1440, 390]) {
  test(`#/skills content stays inside its card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/skills");
    const card = page.locator(".library-detail");
    await expect(card.locator("h2")).toHaveText("long-skill");
    const [scroll, client] = await card.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    const main = page.locator("main");
    const [mainScroll, mainClient] = await main.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(mainScroll).toBeLessThanOrEqual(mainClient);
  });
}

/** Tasks for the sidebar, oldest first: SIDE-1 waits on a gate, SIDE-2 runs, the rest are idle. */
function manyTasks(count: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    key: `SIDE-${i + 1}`,
    title: `Việc số ${i + 1} có tiêu đề khá dài để thử cắt chữ`,
    stage: { done: 0, total: 3, step: null },
    historyFile: "00-history.md",
    specFiles: [],
    outputFiles: [],
    updatedAt: now - i * 60_000,
    run: i === 0 ? { phase: "gate", stepIndex: 0, stepStartedAt: now } : i === 1 ? { phase: "running", stepIndex: 0, stepStartedAt: now } : null,
    waitingPermission: false,
    sessionsRunning: 0,
  }));
}

test.describe("sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/tasks", (route) => route.fulfill({ json: manyTasks(18) }));
  });

  test("caps the task list and keeps every nav group on a 1440×900 screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/tasks");
    const sidebar = page.locator("nav.sidebar");
    const rows = sidebar.locator(".nav-tasks .nav-task:not(.nav-task-all)");
    await expect(rows).toHaveCount(6);
    // Needs-you first, then running.
    await expect(rows.nth(0)).toContainText("SIDE-1");
    await expect(rows.nth(1)).toContainText("SIDE-2");
    const all = sidebar.getByRole("link", { name: "Xem tất cả (18)" });
    await expect(all).toHaveAttribute("href", "#/tasks");
    await expect(sidebar.getByRole("link", { name: "Codegraph" })).toBeInViewport({ ratio: 1 });
    const nav = sidebar.locator(".sidebar-nav");
    const [scroll, client] = await nav.evaluate((el) => [el.scrollHeight, el.clientHeight]);
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test("keeps the open task in the list when it is outside the cap", async ({ page }) => {
    await page.goto("/#/tasks/SIDE-15");
    const rows = page.locator("nav.sidebar .nav-tasks .nav-task:not(.nav-task-all)");
    await expect(rows).toHaveCount(7);
    await expect(rows.last()).toContainText("SIDE-15");
    await expect(rows.last()).toHaveAttribute("aria-current", "page");
  });

  test("shows the task list only on the Task pages, the waiting badge everywhere", async ({ page }) => {
    await page.goto("/#/memory");
    const sidebar = page.locator("nav.sidebar");
    await expect(sidebar.locator('a.nav-item[href="#/tasks"] .nav-badge')).toHaveText("1");
    await expect(sidebar.locator(".nav-tasks")).toHaveCount(0);
  });

  test("folds a group, remembers it, and unfolds it for the page being opened", async ({ page }) => {
    await page.goto("/#/");
    const sidebar = page.locator("nav.sidebar");
    const toggle = sidebar.getByRole("button", { name: "Cấu hình Claude" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar.getByRole("link", { name: "Hooks" })).toBeHidden();
    await page.reload();
    await expect(sidebar.getByRole("button", { name: "Cấu hình Claude" })).toHaveAttribute("aria-expanded", "false");
    await page.goto("/#/hooks");
    await expect(sidebar.getByRole("button", { name: "Cấu hình Claude" })).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar.getByRole("link", { name: "Hooks" })).toHaveAttribute("aria-current", "page");
  });

  test("log out and agent versions sit in the sidebar, not the footer", async ({ page }) => {
    await page.goto("/#/");
    const account = page.locator("nav.sidebar .sidebar-account");
    await expect(account.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
    await expect(account).toContainText(/claude/);
    const footer = page.locator("footer.status-bar");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
    await expect(footer).not.toContainText(/claude \S|không tìm thấy claude|copilot \d/);
  });

  test("fits a 390px screen without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/tasks");
    const sidebar = page.locator("nav.sidebar");
    await expect(sidebar.locator(".nav-tasks .nav-task:not(.nav-task-all)")).toHaveCount(6);
    for (const el of [sidebar, sidebar.locator(".sidebar-nav")]) {
      const [scroll, client] = await el.evaluate((x) => [x.scrollWidth, x.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    }
    await expect(sidebar.getByRole("button", { name: "Đăng xuất" })).toBeInViewport();
    const [docScroll, docClient] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(docScroll).toBeLessThanOrEqual(docClient);
  });
});
