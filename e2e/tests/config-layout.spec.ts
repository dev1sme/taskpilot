import { expect, test, type Locator, type Page } from "@playwright/test";
import { LONG_AGENT, LONG_MCP, openFixtureRepo } from "../fixtures/repo";

/** Mid widths where the config pages broke: below the sidebar-collapse width up to a laptop. */
const WIDTHS = [900, 1000, 1120, 1440];

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function openAt(page: Page, width: number, route: string) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/#${route}`);
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test("agent badge stays one line next to a long agent name", async ({ page }) => {
      await openAt(page, width, "/agents");
      const item = page.locator(".lib-item", { hasText: LONG_AGENT });
      const pill = item.locator(".check-pill");
      await expect(pill).toHaveText("leader · member");
      expect((await box(pill)).height).toBeLessThan(28);
      // The name is cut with an ellipsis and keeps its full text in the tooltip.
      await expect(item.locator(".lib-name")).toHaveAttribute("title", LONG_AGENT);
      const name = item.locator(".lib-name");
      expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect((await box(name)).height).toBeLessThan(28);
      // The pill is inside the row.
      const row = await box(item);
      const p = await box(pill);
      expect(p.x + p.width).toBeLessThanOrEqual(row.x + row.width);
    });

    test("page tab rows have no vertical scroll", async ({ page }) => {
      for (const route of ["/agents", "/commands", "/skills", "/workflow", "/formats"]) {
        await openAt(page, width, route);
        const tabs = page.locator(".page-tabs");
        await expect(tabs, route).toHaveCount(["/agents", "/commands", "/skills"].includes(route) ? 2 : 1);
        for (const tab of await tabs.all()) {
          const { scrollHeight, clientHeight } = await tab.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
          expect(scrollHeight, `${route} .page-tabs scrollHeight`).toBeLessThanOrEqual(clientHeight);
        }
      }
    });

    test("overview inventory labels fit their cells", async ({ page }) => {
      await openAt(page, width, "/");
      const cells = page.locator(".inventory .inv");
      await expect(cells).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const cell = cells.nth(i);
        const label = cell.locator(".inv-label");
        expect(await label.evaluate((el) => el.scrollWidth - el.clientWidth), `label ${i} clipped`).toBeLessThanOrEqual(0);
        const c = await box(cell);
        const l = await box(label);
        expect(l.x).toBeGreaterThanOrEqual(c.x);
        expect(l.x + l.width).toBeLessThanOrEqual(c.x + c.width);
        // The text, not only its box, stays inside the cell.
        const textRight = await label.evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return r.getBoundingClientRect().right;
        });
        expect(textRight, `label ${i} text`).toBeLessThanOrEqual(c.x + c.width);
        // One line: a word broken in the middle ("Comman" / "ds") also stays inside the cell.
        const lines = await label.evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return r.getClientRects().length;
        });
        expect(lines, `label ${i} lines`).toBe(1);
      }
    });

    test("MCP detail actions stay inside the card", async ({ page }) => {
      await openAt(page, width, "/mcp");
      await page.locator(".mcp-item", { hasText: LONG_MCP }).click();
      const card = page.locator(".library-detail");
      await expect(card.getByRole("heading", { name: LONG_MCP })).toBeVisible();
      const c = await box(card);
      const buttons = card.locator(".lib-actions button");
      await expect(buttons).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const b = await box(buttons.nth(i));
        expect(b.x, `button ${i} left`).toBeGreaterThanOrEqual(c.x);
        expect(b.x + b.width, `button ${i} right`).toBeLessThanOrEqual(c.x + c.width);
      }
      const actions = await box(card.locator(".lib-actions"));
      expect(actions.x + actions.width).toBeLessThanOrEqual(c.x + c.width);
    });
  });
}
