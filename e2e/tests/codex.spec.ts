import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSelectionRepo } from "../fixtures/repo";

// Uses the synthetic Codex PTY/probe only. Native lifecycle remains explicitly unverified.
async function start(page: Page, scenario: string, name: string) {
  const repo = createSelectionRepo(`codex-observation-${name}`);
  writeFileSync(path.join(repo, ".fake-codex-scenario"), scenario);
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
  const response = await page.request.post("/api/tasks/DEMO-1/run", { data: { execution: { agent: "codex", model: "gpt-6.1-sol" } } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto("/#/tasks/DEMO-1");
  return repo;
}
async function current(page: Page) {
  return (await page.request.get("/api/tasks/DEMO-1/run")).json();
}
async function cleanup(page: Page) {
  await page.request.delete("/api/tasks/DEMO-1/run");
}

test("Codex shows cumulative metrics and unverified native lifecycle without inventing children", async ({ page }) => {
  const repo = await start(page, "duplicate", "data");
  try {
    await expect.poll(async () => (await current(page)).usage?.totals?.inputTokens).toBe(120);
    const before = await current(page);
    expect(before.run.phase).toBe("waiting");
    const metricsSummary = page
      .locator("summary")
      .filter({ hasText: /^Số liệu từ/ })
      .first();
    await metricsSummary.click();
    await expect(page.getByText(/Chi phí Codex: không hỗ trợ/)).toBeVisible();
    await expect(page.getByText("120", { exact: false }).first()).toBeVisible();
    const note = page
      .locator("summary")
      .filter({ hasText: /Quan sát Codex/ })
      .first();
    await note.click();
    await expect(page.getByText("Agent con của Codex", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Chưa xác minh/).first()).toBeVisible();
    const feed = await (await page.request.get("/api/tasks/DEMO-1/activity")).json();
    expect(feed.filter((item: { kind: string }) => item.kind === "stop")).toHaveLength(1);
    expect(feed.some((item: { kind: string }) => item.kind === "child")).toBe(false);
    writeFileSync(path.join(repo, ".fake-codex-scenario"), "missing");
    expect((await page.request.post("/api/tasks/DEMO-1/run/reply", { data: { text: "Synthetic missing source" } })).ok()).toBe(true);
    await expect.poll(async () => (await current(page)).usage.sessions[0].measurements[0].availability?.state).toBe("stale");
    await expect(page.getByText(/Số liệu lần trước/)).toBeVisible();
    expect((await current(page)).usage.totals.inputTokens).toBe(120);
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          page: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 12)
            .map((el) => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })),
        }));
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: JSON.stringify(overflow) }).toBeLessThanOrEqual(width);
        await metricsSummary.scrollIntoViewIfNeeded();
        if (width === 375 || width === 1440) await page.screenshot({ path: `/tmp/tpl039-ui-${width}-${theme}.png`, fullPage: true });
      }
    }
    await page.reload();
    await metricsSummary.click();
    await expect(page.getByText(/File số liệu không còn tồn tại/)).toBeVisible();
  } finally {
    await cleanup(page);
  }
});

test("missing metrics and silent hooks have explicit UI states, with no fake zero", async ({ page }) => {
  await start(page, "missing", "missing");
  try {
    await expect.poll(async () => (await current(page)).usage?.sessions[0]?.measurements[0]?.availability?.state).toBe("missing");
    expect((await current(page)).usage.totals).toEqual({});
    await page
      .locator("summary")
      .filter({ hasText: /^Số liệu từ/ })
      .first()
      .click();
    await expect(page.getByText(/Không có dữ liệu.*File số liệu/)).toBeVisible();
  } finally {
    await cleanup(page);
  }
  await start(page, "no-hook", "silent");
  try {
    await expect(
      page
        .locator("summary")
        .filter({ hasText: /Quan sát Codex/ })
        .first(),
    ).toContainText("Chưa nhận hook");
    expect((await current(page)).usage.totals).toEqual({});
  } finally {
    await cleanup(page);
  }
});

test("a measured zero remains zero rather than a missing-data placeholder", async ({ page }) => {
  await start(page, "zero", "zero");
  try {
    await expect.poll(async () => (await current(page)).usage?.totals?.inputTokens).toBe(0);
    await page
      .locator("summary")
      .filter({ hasText: /^Số liệu từ/ })
      .first()
      .click();
    await expect(page.getByText("Có số đo 1/1 session")).toHaveCount(2);
    expect((await current(page)).usage.totals).toEqual({ inputTokens: 0, outputTokens: 0 });
  } finally {
    await cleanup(page);
  }
});
