import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("a server another scope hides has no check button, only a hint", async ({ page }) => {
  await page.goto("/#/mcp");
  const detail = page.locator(".library-detail");

  // Project tab: `docs` is hidden by the local one, so a check would test the other copy.
  await expect(detail.getByRole("heading", { name: "docs" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Kiểm tra kết nối" })).toHaveCount(0);
  await expect(detail.getByText("Claude dùng bản ở Local; kiểm tra ở tab đó.")).toBeVisible();

  // Local tab: the winning copy keeps the button and has no hint.
  await page.getByRole("tablist", { name: "File MCP" }).getByRole("tab", { name: "~/.claude.json · repo này" }).click();
  await expect(detail.getByRole("heading", { name: "docs" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Kiểm tra kết nối" })).toBeVisible();
  await expect(detail.getByText(/kiểm tra ở tab đó/)).toHaveCount(0);
});

test("saving a server name with spaces around it opens that server", async ({ page }) => {
  // The real list plus one server that sorts after the fixture's, so "first in list" is not the new one.
  await page.route("**/api/config/mcp", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    body.servers.push({ name: "zeta", scope: "project", type: "http", url: "https://zeta.example/mcp", args: [], env: [], headers: [], missingEnv: [], fromTaskPilot: [] });
    await route.fulfill({ response: res, json: body });
  });
  await page.route("**/api/config/mcp/project/preview", (route) => route.fulfill({ json: { diff: "+zeta", changed: true, stale: false, secrets: [] } }));
  await page.route("**/api/config/mcp/project", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await route.fulfill({ json: { hash: "h", backup: { id: "b", at: 0, path: "x", display: "x", reason: "save", bytes: 1, existed: true } } });
  });

  await page.goto("/#/mcp");
  const detail = page.locator(".library-detail");
  await expect(detail.getByRole("heading", { name: "docs" })).toBeVisible();

  const toolbar = page.locator(".toolbar");
  await toolbar.getByRole("button", { name: "Thêm", exact: true }).click();
  await page.getByLabel("Tên", { exact: true }).fill("zeta ");
  await page.getByLabel("Kiểu").selectOption("http");
  await page.getByLabel("URL", { exact: true }).fill("https://zeta.example/mcp");
  await toolbar.getByRole("button", { name: "Xem thay đổi & lưu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Thêm server" }).click();

  await expect(detail.getByRole("heading", { name: "zeta" })).toBeVisible();
});

test("MCP reads each CLI's native source and keeps Copilot's shared source read only", async ({ page }) => {
  const cases = [
    { cli: "claude", name: "docs", source: ".mcp.json" },
    { cli: "copilot", name: "copilot-docs", source: ".github/mcp.json" },
    { cli: "codex", name: "codex-docs", source: ".codex/config.toml" },
  ] as const;
  for (const { cli, name, source } of cases) {
    const response = await page.request.get(`/api/config/mcp?cli=${cli}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain("e2e-secret-copilot");
    const config = (await response.json()) as { servers: Array<{ name: string; source?: string; editable?: boolean }>; sources: Array<{ path: string }> };
    expect(config.sources.some((item) => item.path === source)).toBe(true);
    expect(config.servers.find((item) => item.name === name)?.source ?? source).toBe(source);
    if (cli === "copilot") {
      expect(config.servers.find((item) => item.name === "docs")).toMatchObject({ source: ".mcp.json", editable: false });
    }
  }
  const invalidScope = await page.request.get("/api/config/mcp/local/docs?cli=codex");
  expect(invalidScope.status()).toBe(400);
});
