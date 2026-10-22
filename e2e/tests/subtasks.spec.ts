import { expect, test, type Page } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

const STEPS = [
  { id: "investigate", title: "Điều tra & lên kế hoạch", gate: "approve", doneFile: "02-plan.md", outputs: [{ id: "plan", file: "02-plan.md" }], dispatch: null },
  { id: "dispatch", title: "Giao việc", gate: "none", doneFile: null, outputs: [], dispatch: { from: "plan", report: "03-viec-{{n}}.md", parallel: 2 } },
  { id: "review", title: "Rà soát", gate: "approve", doneFile: "04-summary.md", outputs: [{ id: "summary", file: "04-summary.md" }], dispatch: null },
];
const ITEMS = [
  { n: 1, title: "Parser", agent: "claude", files: ["server/a.ts"], output: "parser", deps: [] },
  { n: 2, title: "Giao diện", agent: "copilot", files: ["client/"], output: "ui", deps: [1] },
];
const LEADER = "00000000-0000-4000-8000-000000000001";

// Runs are faked at the network layer (as in questions.spec.ts): a real one would launch the agents.
async function fakeRun(page: Page, opts: { stepIndex: number; phase: string; subtasks?: unknown[]; assignments?: unknown; subtaskQuestions?: unknown }) {
  const now = Date.now();
  const run = {
    repo: "/repo",
    taskKey: "PROJ-1",
    sessionId: LEADER,
    stepIndex: opts.stepIndex,
    phase: opts.phase,
    stepStartedAt: now,
    message: "Đang giao việc.",
    startedAt: now,
    updatedAt: now,
    subtasks: opts.subtasks,
  };
  const sent: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/tasks/PROJ-1/run", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            workflow: { source: "leader", origin: "default", historyFile: "00-history.md", steps: STEPS, outdated: false },
            run,
            questions: [],
            assignments: opts.assignments ?? null,
            subtaskQuestions: opts.subtaskQuestions ?? {},
          },
        })
      : route.fallback(),
  );
  await page.route(/\/api\/tasks\/PROJ-1\/run\/(approve|subtasks\/\d+\/(reply|retry|complete))$/, (route) => {
    sent.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: run });
  });
  return sent;
}

const sub = (n: number, phase: string, extra: Record<string, unknown> = {}) => ({ ...ITEMS[n - 1], phase, report: `03-viec-${n}.md`, ...extra });

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("the plan gate lists the subtasks approving would start", async ({ page }) => {
  const sent = await fakeRun(page, { stepIndex: 0, phase: "gate", assignments: { items: ITEMS, errors: [] } });
  await page.goto("/#/tasks/PROJ-1");
  const preview = page.getByRole("region", { name: "Các việc con của kế hoạch" });
  await expect(preview).toContainText("Claude giao 2 việc con (chạy tối đa 2 việc cùng lúc)");
  await expect(preview).toContainText("Parser");
  await expect(preview).toContainText("sau việc 1");
  await page.getByRole("button", { name: "Duyệt, sang bước tiếp" }).click();
  await expect.poll(() => sent).toEqual([{ url: "/api/tasks/PROJ-1/run/approve", body: { note: "" } }]);
});

test("a plan whose table cannot run cannot be approved, and says why", async ({ page }) => {
  await fakeRun(page, { stepIndex: 0, phase: "gate", assignments: { items: [], errors: ['row 1: unknown agent "gemini"'] } });
  await page.goto("/#/tasks/PROJ-1");
  const preview = page.getByRole("region", { name: "Các việc con của kế hoạch" });
  await expect(preview).toContainText('unknown agent "gemini"');
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp" })).toBeDisabled();
});

test("each subtask shows its state; a waiting one is answered on its own", async ({ page }) => {
  const sent = await fakeRun(page, {
    stepIndex: 1,
    phase: "waiting",
    subtasks: [sub(1, "running"), sub(2, "waiting")],
    subtaskQuestions: { 2: [{ n: 1, text: "Dùng thư viện nào?", proposal: "React" }] },
  });
  await page.goto("/#/tasks/PROJ-1");
  const card = page.locator(".now-card");
  await expect(card).toContainText("Giao việc: 0/2 việc xong");
  const rows = card.locator(".subtask-row");
  await expect(rows.nth(0)).toContainText("đang làm");
  await expect(rows.nth(1)).toContainText("đang chờ ba");
  await expect(rows.nth(1).getByRole("group", { name: "Copilot hỏi 1 câu" })).toContainText("Dùng thư viện nào?");
  await rows.nth(1).getByRole("button", { name: "Gửi trả lời" }).click();
  await expect.poll(() => sent).toEqual([{ url: "/api/tasks/PROJ-1/run/subtasks/2/reply", body: { text: "1. Dùng thư viện nào?\n   → Theo đề xuất: React" } }]);
});

test("an interrupted subtask is retried on its own", async ({ page }) => {
  const sent = await fakeRun(page, { stepIndex: 1, phase: "interrupted", subtasks: [sub(1, "done"), sub(2, "interrupted", { sessionId: "00000000-0000-4000-8000-000000000002" })] });
  await page.goto("/#/tasks/PROJ-1");
  const rows = page.locator(".now-card .subtask-row");
  await expect(rows.nth(0)).toContainText("xong");
  await expect(rows.nth(0).getByRole("button", { name: "Đọc 03-viec-1.md" })).toBeVisible();
  await rows.nth(1).getByRole("button", { name: "Gửi lại việc" }).click();
  await expect.poll(() => sent).toEqual([{ url: "/api/tasks/PROJ-1/run/subtasks/2/retry", body: null }]);
});

test("a Copilot subtask that sends no hook is flagged and marked done by hand after a confirmation", async ({ page }) => {
  const sent = await fakeRun(page, { stepIndex: 1, phase: "running", subtasks: [sub(1, "done"), sub(2, "running", { noHook: true, sessionId: "00000000-0000-4000-8000-000000000002" })] });
  await page.goto("/#/tasks/PROJ-1");
  const row = page.locator(".now-card .subtask-row").nth(1);
  await expect(row).toContainText("Copilot không gửi hook");
  await row.getByRole("button", { name: "Đánh dấu xong" }).click();
  expect(sent).toEqual([]);
  await row.getByRole("button", { name: "Xác nhận: xong" }).click();
  await expect.poll(() => sent).toEqual([{ url: "/api/tasks/PROJ-1/run/subtasks/2/complete", body: null }]);
});

test("the plan gate shows the subagent and model the table gives", async ({ page }) => {
  const items = [{ ...ITEMS[0], subagent: "taskpilot-implementer", model: "haiku" }, ITEMS[1]];
  await fakeRun(page, { stepIndex: 0, phase: "gate", assignments: { items, errors: [] } });
  await page.goto("/#/tasks/PROJ-1");
  const rows = page.getByRole("region", { name: "Các việc con của kế hoạch" }).locator(".subtask-row");
  await expect(rows.nth(0)).toContainText("subagent taskpilot-implementer");
  await expect(rows.nth(0)).toContainText("model haiku");
  await expect(rows.nth(1).locator(".subtask-as")).toHaveCount(0);
});

test("each subtask shows its model, time and cost; a missing part is said", async ({ page }) => {
  await fakeRun(page, {
    stepIndex: 1,
    phase: "running",
    subtasks: [
      sub(1, "done", { subagent: "taskpilot-implementer", model: "haiku", metrics: { model: "claude-haiku-4-5", costUsd: 0.4213, durationMs: 725_000 } }),
      sub(2, "done", { model: "gpt-5", metrics: { model: "gpt-5", durationMs: 40_000 } }),
    ],
  });
  await page.goto("/#/tasks/PROJ-1");
  const rows = page.locator(".now-card .subtask-row");
  const first = rows.nth(0).getByLabel("Số liệu: model, thời gian, chi phí");
  await expect(first).toContainText("claude-haiku-4-5");
  await expect(first).toContainText("12m 5s");
  await expect(first).toContainText("$0.42");
  await expect(rows.nth(0)).toContainText("subagent taskpilot-implementer");
  await expect(rows.nth(1).getByLabel("Số liệu: model, thời gian, chi phí")).toContainText("chi phí không có");
});

test("a workflow that gives subtasks out says when no subagent can run one", async ({ page }) => {
  await page.route("**/api/config/agents", (route) =>
    route.fulfill({ json: [{ kind: "agents", scope: "project", name: "explorer", check: { status: "ok", roles: ["leader"], problems: [] } }] }),
  );
  await fakeRun(page, { stepIndex: 0, phase: "running" });
  await page.goto("/#/tasks/PROJ-1");
  const notice = page.getByRole("status").filter({ hasText: "Repo chưa có subagent nào làm được việc con" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: "Thêm subagent" })).toHaveAttribute("href", "#/agents");
});

test("no notice when an agent can run a subtask", async ({ page }) => {
  // The fixture's reviewer declares no tools, so it has them all and can be a member.
  await fakeRun(page, { stepIndex: 0, phase: "running" });
  await page.goto("/#/tasks/PROJ-1");
  await expect(page.locator(".now-card")).toBeVisible();
  await expect(page.getByText("Repo chưa có subagent nào làm được việc con")).toHaveCount(0);
});
