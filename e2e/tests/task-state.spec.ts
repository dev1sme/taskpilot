import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";
const SESSION_C = "00000000-0000-4000-8000-00000000000c";

const STEPS = [
  { id: "investigate", title: "Điều tra & lên kế hoạch", agent: "claude", gate: "approve", doneFile: "02-plan.md", outputs: [{ id: "plan", file: "02-plan.md" }] },
  { id: "implement", title: "Triển khai", agent: "claude", gate: "approve", doneFile: "04-summary.md", outputs: [{ id: "summary", file: "04-summary.md" }] },
];

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  taskKey: "PROJ-1",
  title: `Session ${id.slice(-1)}`,
  agent: "claude",
  createdAt: 1_700_000_000_000,
  status: "running",
  exitCode: null,
  activity: "idle",
  ...extra,
});

type Questions = Array<{ n: number; text: string; proposal?: string }>;

/**
 * The run and the task's sessions are faked at the network layer: a real run would launch claude.
 * A test changes what the next GET answers, then clicks "Huỷ" (it refetches both) to make the page see it.
 */
async function fakeTask(page: Page, init: { phase: string; sessionId?: string; stepIndex?: number; questions?: Questions; sessions?: unknown[] }) {
  const state = {
    phase: init.phase,
    sessionId: init.sessionId ?? SESSION_A,
    stepIndex: init.stepIndex ?? 0,
    questions: init.questions ?? ([] as Questions),
    sessions: init.sessions ?? [session(SESSION_A)],
    cancels: 0,
  };
  const now = Date.now();
  await page.route("**/api/tasks/PROJ-1/run", (route) => {
    if (route.request().method() === "DELETE") {
      state.cancels += 1;
      return route.fulfill({ json: {} });
    }
    if (route.request().method() !== "GET") return route.fallback();
    const run = {
      repo: "/repo",
      taskKey: "PROJ-1",
      sessionId: state.sessionId,
      stepIndex: state.stepIndex,
      phase: state.phase,
      stepStartedAt: now,
      message: "Claude đã dừng nhưng chưa ghi 02-plan.md.",
      lastMessage: "Cần ba chốt vài điểm.",
      startedAt: now,
      updatedAt: now,
    };
    return route.fulfill({ json: { workflow: { source: "default", origin: "default", historyFile: "00-history.md", steps: STEPS, outdated: false }, run, questions: state.questions } });
  });
  await page.route("**/api/tasks/PROJ-1/sessions", (route) => (route.request().method() === "GET" ? route.fulfill({ json: state.sessions }) : route.fallback()));
  return state;
}

/** Makes the page refetch the run and the sessions: cancelling reloads both. */
async function refetch(page: Page, state: { cancels: number }) {
  const before = state.cancels;
  await page.locator(".toolbar").getByRole("button", { name: "Huỷ", exact: true }).click();
  await expect.poll(() => state.cancels).toBeGreaterThan(before);
}

const drawer = (page: Page) => page.locator("section.drawer");

test("a task session that asks for permission opens the terminal and is selected", async ({ page }) => {
  // The asking session is not the last one, so selecting it is not the drawer's default.
  await fakeTask(page, { phase: "running", sessionId: SESSION_C, sessions: [session(SESSION_A, { activity: "permission" }), session(SESSION_B), session(SESSION_C)] });
  await page.goto("/#/tasks/PROJ-1");

  await expect(drawer(page).getByRole("button", { name: /^Terminal/ })).toHaveAttribute("aria-expanded", "true");
  await expect(drawer(page).locator(".drawer-session.is-active")).toContainText("Session a");
});

test("a task session that starts asking later opens the terminal and is selected", async ({ page }) => {
  const state = await fakeTask(page, { phase: "running", sessionId: SESSION_C, sessions: [session(SESSION_A), session(SESSION_B), session(SESSION_C)] });
  await page.goto("/#/tasks/PROJ-1");
  await expect(drawer(page).getByRole("button", { name: /^Terminal/ })).toHaveAttribute("aria-expanded", "false");
  await expect(drawer(page).locator(".drawer-session.is-active")).toContainText("Session c");

  state.sessions = [session(SESSION_A), session(SESSION_B, { activity: "permission" }), session(SESSION_C)];
  await refetch(page, state);

  await expect(drawer(page).getByRole("button", { name: /^Terminal/ })).toHaveAttribute("aria-expanded", "true");
  await expect(drawer(page).locator(".drawer-session.is-active")).toContainText("Session b");
});

test("the terminal tab follows the run's session when it changes", async ({ page }) => {
  const state = await fakeTask(page, { phase: "running", sessionId: SESSION_A, sessions: [session(SESSION_A), session(SESSION_B), session(SESSION_C)] });
  await page.goto("/#/tasks/PROJ-1");
  // The run's session, not the last one the drawer would pick by default.
  await expect(drawer(page).locator(".drawer-session.is-active")).toContainText("Session a");

  state.sessionId = SESSION_B;
  await refetch(page, state);
  await expect(drawer(page).locator(".drawer-session.is-active")).toContainText("Session b");
});

test("a restart confirmation does not carry over to the next step", async ({ page }) => {
  const state = await fakeTask(page, { phase: "running", stepIndex: 0 });
  await page.goto("/#/tasks/PROJ-1");
  const toolbar = page.locator(".toolbar");
  await toolbar.getByRole("button", { name: "Chạy lại từ đầu" }).click();
  await expect(toolbar.getByText("Bản cũ của tài liệu được lưu vào archive/")).toBeVisible();

  // Another refetch with the same phase and step keeps the question open.
  await refetch(page, state);
  await expect(toolbar.getByRole("button", { name: "Xác nhận chạy lại" })).toBeVisible();

  state.stepIndex = 1;
  await refetch(page, state);
  await expect(toolbar.getByRole("button", { name: "Xác nhận chạy lại" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Chạy lại từ đầu" })).toBeVisible();
});

test("a restart confirmation does not carry over to the next phase", async ({ page }) => {
  const state = await fakeTask(page, { phase: "running" });
  await page.goto("/#/tasks/PROJ-1");
  const toolbar = page.locator(".toolbar");
  await toolbar.getByRole("button", { name: "Chạy lại từ đầu" }).click();
  await expect(toolbar.getByRole("button", { name: "Xác nhận chạy lại" })).toBeVisible();

  state.phase = "waiting";
  await refetch(page, state);
  await expect(toolbar.getByRole("button", { name: "Xác nhận chạy lại" })).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "Chạy lại từ đầu" })).toBeVisible();
});

test("when Claude asks new questions at the gate, the answers go back to the proposals", async ({ page }) => {
  const state = await fakeTask(page, { phase: "gate", questions: [{ n: 1, text: "Đổi tên bước 2?", proposal: "đổi thành Triển khai" }] });
  await page.goto("/#/tasks/PROJ-1");
  const card = page.locator(".gate-card");
  const proposal = card.getByRole("radio", { name: "Theo đề xuất: đổi thành Triển khai" });
  await expect(proposal).toBeChecked();
  await card.getByRole("radio", { name: "Chưa trả lời" }).check();
  await expect(proposal).not.toBeChecked();

  // The same questions come back: the answer stays as the user left it.
  await refetch(page, state);
  await expect(card.getByRole("radio", { name: "Chưa trả lời" })).toBeChecked();

  state.questions = [{ n: 1, text: "Có cần banner?", proposal: "có" }];
  await refetch(page, state);
  await expect(card.getByText("Có cần banner?")).toBeVisible();
  await expect(card.getByRole("radio", { name: "Theo đề xuất: có" })).toBeChecked();
});

test("when Claude asks new questions while waiting, the reply form goes back to the proposals", async ({ page }) => {
  const state = await fakeTask(page, { phase: "waiting", questions: [{ n: 1, text: "Đổi tên bước 2?", proposal: "đổi thành Triển khai" }] });
  await page.goto("/#/tasks/PROJ-1");
  const card = page.locator(".now-card");
  await expect(card.getByRole("radio", { name: "Theo đề xuất: đổi thành Triển khai" })).toBeChecked();
  await card.getByRole("radio", { name: "Chưa trả lời" }).check();

  // The same questions come back: the answer stays as the user left it.
  await refetch(page, state);
  await expect(card.getByRole("radio", { name: "Chưa trả lời" })).toBeChecked();

  state.questions = [{ n: 1, text: "Có cần banner?", proposal: "có" }];
  await refetch(page, state);
  await expect(card.getByText("Có cần banner?")).toBeVisible();
  await expect(card.getByRole("radio", { name: "Theo đề xuất: có" })).toBeChecked();
});
