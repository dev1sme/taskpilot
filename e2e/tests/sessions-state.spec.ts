import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  taskKey: "@repo",
  title: `Session ${id}`,
  agent: "claude",
  createdAt: 1_700_000_000_000,
  status: "running",
  exitCode: null,
  activity: "idle",
  ...extra,
});

/** Repo sessions are faked at the network layer so a test can decide what the agent is doing. */
async function fakeRepoSessions(page: Page, initial: unknown[]) {
  const state = { sessions: initial, gets: 0 };
  await page.route("**/api/repo/sessions", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    state.gets += 1;
    return route.fulfill({ json: state.sessions });
  });
  return state;
}

test("a repo session that asks for permission opens the terminal and is selected", async ({ page }) => {
  // The asking session is not the last one, so selecting it is not the drawer's default.
  await fakeRepoSessions(page, [session("asking", { activity: "permission" }), session("quiet")]);
  await page.goto("/#/");

  const drawer = page.getByRole("region", { name: "Terminal repo" });
  await expect(drawer).toBeVisible();
  await expect(page.locator("footer.status-bar").getByRole("button", { name: /^Terminal/ })).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.locator(".drawer-session.is-active")).toContainText("Session asking");
});

test("a repo session that starts asking later opens the terminal and is selected", async ({ page }) => {
  const state = await fakeRepoSessions(page, [session("asking"), session("quiet")]);
  await page.goto("/#/");
  await expect(page.locator(".repo-terminal")).toHaveCount(0);

  state.sessions = [session("asking", { activity: "permission" }), session("quiet")];
  const before = state.gets;
  // Returning to the tab refetches the list.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => state.gets).toBeGreaterThan(before);

  const drawer = page.getByRole("region", { name: "Terminal repo" });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".drawer-session.is-active")).toContainText("Session asking");
});

test("when the terminal reports the PTY exited, the session list reloads", async ({ page }) => {
  const state = await fakeRepoSessions(page, [session("one")]);
  await page.routeWebSocket("**/api/sessions/one/pty", (ws) => {
    ws.onMessage(() => {
      // The first resize frame is what makes the server answer; here it answers with the exit.
      ws.send(JSON.stringify({ t: "x", code: 0 }));
    });
  });
  await page.goto("/#/");

  const before = state.gets;
  state.sessions = [session("one", { status: "exited", exitCode: 0 })];
  await page
    .locator("footer.status-bar")
    .getByRole("button", { name: /^Terminal/ })
    .click();

  const drawer = page.getByRole("region", { name: "Terminal repo" });
  await expect(drawer.getByRole("button", { name: "Resume" })).toBeVisible();
  expect(state.gets).toBeGreaterThan(before);
});
