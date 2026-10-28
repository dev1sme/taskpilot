import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("settings shows one file per scope tab", async ({ page }) => {
  await page.goto("/#/settings");
  const tabs = page.getByRole("tablist", { name: "File settings" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(page.locator(".scope-section")).toHaveCount(1);
  await expect(page.locator(".scope-section h2")).toHaveText(".claude/settings.json");
  await expect(page.getByText("npm test:*")).toBeVisible();

  await tabs.getByRole("tab", { name: ".claude/settings.local.json" }).click();
  await expect(page.locator(".scope-section h2")).toHaveText(".claude/settings.local.json");
  await expect(page.getByText("npm test:*")).toHaveCount(0);
  await expect(page.getByText('Bấm "Sửa quyền" ở từng file')).toHaveCount(0);
});

test("settings edit opens from the toolbar and cancels", async ({ page }) => {
  await page.goto("/#/settings");
  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.locator(".perm-editor")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Xem thay đổi & lưu" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".perm-editor")).toHaveCount(0);
});

test("hooks shows the JSON block of the file and edits from the toolbar", async ({ page }) => {
  await page.goto("/#/hooks");
  const code = page.locator(".code-view");
  await expect(code).toContainText('"PostToolUse": [');
  await expect(code).toContainText('"command": "npx prettier --write ."');
  await expect(page.getByRole("navigation", { name: "Sự kiện" })).toContainText("PostToolUse");

  const toolbar = page.locator(".config-toolbar");
  await toolbar.getByRole("button", { name: "Sửa", exact: true }).click();
  await expect(page.locator(".hooks-editor")).toBeVisible();
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.locator(".hooks-editor")).toHaveCount(0);
});

test("hooks tab of a file without hooks offers to add one", async ({ page }) => {
  await page.goto("/#/hooks");
  await page.getByRole("tab", { name: ".claude/settings.local.json" }).click();
  await expect(page.getByText(".claude/settings.local.json chưa có hook nào")).toBeVisible();
  await page.locator(".config-toolbar").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".hook-row")).toHaveCount(1);
  // The empty starter row alone is not an unsaved change.
  await expect(page.getByText("Chưa lưu")).toHaveCount(0);
});

test("agents show one tab per folder and mark the agent another scope hides", async ({ page }) => {
  await page.goto("/#/agents");
  const tabs = page.getByRole("tablist", { name: "Thư mục agents" });
  await expect(tabs.getByRole("tab", { name: /\.claude\/agents \(2\)$/ })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: /claude\/agents \(1\)$/ })).toBeVisible();
  const list = page.locator(".library-list");
  await expect(list.locator(".lib-item")).toHaveCount(2);
  await expect(list.getByText("Review của repo")).toBeVisible();
  await expect(list.locator(".shadow-pill")).toHaveCount(0);

  await tabs.getByRole("tab", { name: /claude\/agents \(1\)$/ }).click();
  await expect(list.getByText("Review của ba")).toBeVisible();
  await expect(list.getByText("Review của repo")).toHaveCount(0);
  await expect(list.locator(".shadow-pill")).toHaveText("Bị Project che");
});

test("new item goes to the folder of the open tab", async ({ page }) => {
  await page.goto("/#/commands");
  await page.getByRole("tablist", { name: "Thư mục commands" }).getByRole("tab", { name: "~/.claude/commands" }).click();
  await expect(page.getByRole("heading", { name: "Chưa có command trong ~/.claude/commands" })).toBeVisible();
  await page.locator(".toolbar").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("~/.claude/commands (mọi repo)")).toBeVisible();
});

test("mcp shows three scope tabs and marks the server a local one hides", async ({ page }) => {
  await page.goto("/#/mcp");
  const tabs = page.getByRole("tablist", { name: "File MCP" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  const list = page.locator(".mcp-list");
  await expect(list.locator(".mcp-item")).toHaveCount(2);
  await expect(list.locator(".shadow-pill")).toHaveText("Bị Local che");

  await tabs.getByRole("tab", { name: "~/.claude.json · repo này" }).click();
  await expect(list.locator(".shadow-pill")).toHaveCount(0);
  await expect(page.locator(".library-detail .lib-path")).toHaveText(/claude\.json/);

  await tabs.getByRole("tab", { name: /~\/\.claude\.json \(0\)$/ }).click();
  await expect(page.getByRole("heading", { name: /Chưa có MCP server trong .*claude\.json/ })).toBeVisible();
});

test("CLI selector keeps the selected agent in native configuration routes", async ({ page }) => {
  await page.goto("/#/memory");
  const selector = page.getByRole("navigation", { name: "CLI cấu hình" });
  await selector.getByRole("link", { name: "Codex" }).click();
  await expect(page).toHaveURL(/#\/memory\?cli=codex$/);
  await expect(selector.getByRole("link", { name: "Codex" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/settings?cli=copilot");
  await expect(selector.getByRole("link", { name: "Copilot" })).toHaveAttribute("aria-current", "page");
  await page.goto("/#/workflow");
  await expect(selector).toHaveCount(0);
});

test("native configuration pages render the selected CLI files", async ({ page }) => {
  await page.goto("/#/memory?cli=codex");
  await expect(page.getByRole("tablist", { name: "File hướng dẫn" }).getByRole("tab", { name: /^(Project: )?AGENTS\.md$/ })).toBeVisible();
  await expect(page.locator(".code-view")).toContainText("Codex fixture");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("taskpilot.theme", value);
        window.dispatchEvent(new StorageEvent("storage", { key: "taskpilot.theme" }));
      }, theme);
      await page.screenshot({ path: `/tmp/taskpilot-config-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });


  await page.goto("/#/settings?cli=copilot");
  await expect(page.getByRole("tablist", { name: "File settings" }).getByRole("tab", { name: ".github/copilot/settings.json" })).toBeVisible();
  await expect(page.locator(".scope-section")).toContainText(".github/copilot/settings.json");

  await page.goto("/#/agents?cli=codex");
  await expect(page.locator(".library-list")).toContainText("native-reviewer");

  await page.goto("/#/mcp?cli=copilot");
  await expect(page.locator(".mcp-list")).toContainText("copilot-docs");
});

test("native API reads separate instruction and settings files for all three CLIs", async ({ page }) => {
  const cases = [
    { cli: "claude", memory: "CLAUDE.md", settings: ".claude/settings.json", scopes: 3 },
    { cli: "copilot", memory: ".github/copilot-instructions.md", settings: ".github/copilot/settings.json", scopes: 2 },
    { cli: "codex", memory: "AGENTS.md", settings: ".codex/config.toml", scopes: 2 },
  ] as const;
  for (const { cli, memory, settings, scopes } of cases) {
    const memoryResponse = await page.request.get(`/api/config/memory?cli=${cli}`);
    expect(memoryResponse.ok()).toBe(true);
    const files = (await memoryResponse.json()) as Array<{ scope: string; path: string; content: string }>;
    expect(files).toHaveLength(scopes);
    expect(files[0]).toMatchObject({ scope: "project", path: memory });
    expect(files[0].content).toContain(cli === "claude" ? "Fixture repo" : `${cli === "codex" ? "Codex" : "Copilot"} fixture`);

    const settingsResponse = await page.request.get(`/api/config/settings?cli=${cli}`);
    expect(settingsResponse.ok()).toBe(true);
    const settingsFiles = (await settingsResponse.json()) as Array<{ scope: string; path: string }>;
    expect(settingsFiles[0]).toMatchObject({ scope: "project", path: settings });
  }
});

test("Copilot hook files use their native schema while Codex hooks stay unsupported", async ({ page }) => {
  const response = await page.request.get("/api/config/hooks?cli=copilot");
  expect(response.ok()).toBe(true);
  const files = (await response.json()) as Array<{ name: string; path: string; hooks: Array<{ event: string; command: string }> }>;
  expect(files.find((file) => file.name === "fixture.json")).toMatchObject({
    path: ".github/hooks/fixture.json",
    hooks: [{ event: "preToolUse", command: "echo fixture" }],
  });
  const capabilities = (await (await page.request.get("/api/config/capabilities?cli=codex")).json()) as { sections: { hooks: { supported: boolean } } };
  expect(capabilities.sections.hooks.supported).toBe(false);
});

for (const cli of ["claude", "copilot", "codex"] as const) {
  test(`${cli} waits for capability and never loads unavailable native sections`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const nativeRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/config\/(memory|settings|hooks|agents|commands|skills|mcp)$/.test(path)) nativeRequests.push(path);
    });
    await page.route("**/api/config/capabilities?*", async (route) => {
      await pending;
      await route.fulfill({ json: { cli, sections: Object.fromEntries(["memory", "settings", "hooks", "agents", "commands", "skills", "mcp"].map((section) => [section, { supported: true, available: false, scopes: ["user"] }])) } });
    });
    await page.goto(`/#/memory?cli=${cli}`);
    await expect(page.locator(".page-body .hint")).toContainText("Đang");
    expect(nativeRequests).toEqual([]);
    release();
    await expect(page.locator(".empty-card")).toBeVisible();
    for (const section of ["settings", "hooks", "agents", "commands", "skills", "mcp"]) {
      await page.goto(`/#/${section}?cli=${cli}`);
      await expect(page.locator(".empty-card")).toBeVisible();
    }
    expect(nativeRequests).toEqual([]);
  });

  test(`${cli} shows capability errors without requesting native files`, async ({ page }) => {
    let reads = 0;
    await page.route("**/api/config/capabilities?*", (route) => route.fulfill({ status: 500, json: { error: "capability fixture error" } }));
    await page.route("**/api/config/memory?*", (route) => { reads++; return route.fulfill({ json: [] }); });
    await page.goto(`/#/memory?cli=${cli}`);
    await expect(page.getByText("capability fixture error", { exact: true })).toBeVisible();
    expect(reads).toBe(0);
  });
}

test("memory, library and MCP scopes follow capability rather than provider defaults", async ({ page }) => {
  await page.route("**/api/config/capabilities?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const section of ["memory", "agents", "mcp"]) data.sections[section].scopes = ["user"];
    // Codex's project-only agents must also follow the server if its inventory changes.
    await route.fulfill({ json: data });
  });
  for (const cli of ["claude", "copilot", "codex"]) {
    for (const section of ["memory", "agents", "mcp"]) {
      await page.goto(`/#/${section}?cli=${cli}`);
      const tabs = page.locator(".scope-tabs").getByRole("tab");
      await expect(tabs).toHaveCount(1);
      await expect(tabs).toHaveAttribute("aria-selected", "true");
    }
  }
});
