import type {} from "@fastify/websocket";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { SessionView } from "../../client/src/features/sessions/types";
import type { HandoffJournal, RunState } from "../../server/src/modules/workflow/types";
import type { HandoffCommitRequest, HandoffRequest, HandoffPreview } from "../../server/src/modules/workflow/handoff";
import type { RunView } from "../../server/src/modules/workflow/run-view";
type WorkflowStep = RunView["workflow"]["steps"][number];
type HandoffPreviewResult = {
  preview: HandoffPreview;
  requiresConfirmation: boolean;
  preflight: { status: "ready" | "unknown" | "blocked"; errors: Array<{ field: string; message: string }> };
};
import { createSelectionRepo, openFixtureRepo } from "../fixtures/repo";

// Isolated real-engine cases select a repo; run this file with --workers=1.
test.describe.configure({ mode: "serial" });
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const C = "10000000-0000-4000-8000-00000000000c";
const D = "10000000-0000-4000-8000-00000000000d";
const step: WorkflowStep = {
  id: "work",
  title: "Triển khai",
  agent: "claude",
  effective: { agent: "claude", source: "workflow", modelSource: "default" },
  gate: "approve",
  doneFile: "report.md",
  outputs: [],
  dispatch: null,
};
const makeSession = (id: string, extra: Partial<SessionView> = {}): SessionView => ({
  id,
  taskKey: "PROJ-1",
  title: `Session ${id.slice(-1)}`,
  agent: "claude",
  createdAt: 1,
  status: "running",
  exitCode: null,
  activity: "idle",
  ...extra,
});
const panel = (page: Page) => page.getByRole("dialog", { name: "Bàn giao cho agent khác" });
const action = (page: Page) => page.getByRole("button", { name: "Tiếp tục bằng…", exact: true });
const tab = (page: Page) => page.locator(".drawer-session.is-active");

async function fake(page: Page, options: { members?: boolean; asking?: boolean; phase?: RunState["phase"] } = {}) {
  await openFixtureRepo(page);
  const run: RunState = {
    repo: "/fixture",
    taskKey: "PROJ-1",
    sessionId: A,
    stepIndex: 0,
    phase: options.phase ?? "running",
    message: "Fixture",
    startedAt: 1,
    updatedAt: 1,
    stepStartedAt: 1,
  };
  const view: RunView = {
    runMode: null,
    workflow: {
      source: "fixture",
      origin: "repo",
      mode: { id: "default", name: "Default", override: false },
      historyFile: "00-history.md",
      outdated: false,
      steps: [{ ...step, ...(options.members ? { id: "dispatch", dispatch: { from: "plan", report: "03-viec-{{n}}.md", parallel: 2 } } : {}) }],
    },
    run,
    questions: [],
    assignments: null,
    subtaskQuestions: {},
    usage: null,
    subtaskUsage: {},
  };
  if (options.members)
    run.subtasks = [
      { n: 1, title: "Parser", agent: "claude", model: "haiku", files: ["server/"], output: "Parser", deps: [], report: "03-viec-1.md", phase: "running", sessionId: B },
      { n: 2, title: "UI", agent: "claude", files: ["client/"], output: "UI", deps: [], report: "03-viec-2.md", phase: "waiting", sessionId: C },
      { n: 3, title: "Pending", agent: "claude", files: [], output: "Later", deps: [1], report: "03-viec-3.md", phase: "pending" },
      { n: 4, title: "Done", agent: "claude", files: [], output: "Done", deps: [], report: "03-viec-4.md", phase: "done", sessionId: D },
    ];
  const state = {
    view,
    sessions: [makeSession(A), makeSession(B), makeSession(C, { activity: options.asking ? "permission" : "idle" }), makeSession(D)],
    previews: [] as HandoffRequest[],
    commits: [] as HandoffCommitRequest[],
    requiresConfirmation: true,
  };
  await page.route("**/api/tasks/PROJ-1/run", (route) => route.fulfill({ json: view }));
  await page.route("**/api/tasks/PROJ-1/sessions", (route) => route.fulfill({ json: state.sessions }));
  await page.route("**/api/tasks/PROJ-1/run/handoff/preview", (route) => {
    const request: HandoffRequest = route.request().postDataJSON();
    state.previews.push(request);
    const result: HandoffPreviewResult = {
      preview: {
        version: 1,
        id: "1".repeat(64),
        fingerprint: "2".repeat(64),
        createdAt: 1,
        scope: request.scope,
        sourceSessionId: options.members ? B : A,
        expectedGeneration: 2,
        source: { agent: "claude", permissionMode: "default", source: "workflow", modelSource: "default" },
        target: { ...request.target, source: "lane-override", modelSource: request.target.model ? "explicit" : "default" },
        documents: [],
        text: "Filtered fixture preview — read history and report",
        prompt: "Filtered fixture preview",
      },
      requiresConfirmation: state.requiresConfirmation,
      preflight: { status: "unknown", errors: [] },
    };
    return route.fulfill({ json: result });
  });
  await page.goto("/#/tasks/PROJ-1");
  await expect(page.locator(options.phase === "gate" ? ".gate-card" : ".now-card")).toBeVisible();
  return state;
}

async function choose(page: Page, agent = "codex") {
  await panel(page).getByRole("combobox", { name: "Agent", exact: true }).selectOption(agent);
  await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
  await expect(panel(page).locator(".handoff-preview")).toBeVisible({ timeout: 15000 });
}

function operation(request: HandoffCommitRequest, extra: Partial<HandoffJournal> = {}): HandoffJournal {
  return { ...request, stage: "committed", targetSessionId: D, text: "Filtered handoff", createdAt: 1, updatedAt: 2, promptState: "sent", ...extra };
}

const quotaNotice = (page: Page) => page.getByRole("status", { name: "Hạn mức và hướng xử lý" });
const quotaFailure = (): NonNullable<SessionView["failure"]> => ({
  reason: "quota",
  message: "Verified quota fixture",
  observedAt: Date.now(),
  generation: 2,
  evidence: { source: "unclassified" },
});

test("typed turn quota offers explicit actions; Later keeps manual handoff and sends nothing", async ({ page }) => {
  const state = await fake(page, { phase: "interrupted" });
  state.sessions[0] = makeSession(A, { agent: "codex", failure: quotaFailure() });
  await page.reload();
  await expect(quotaNotice(page)).toContainText("Backend báo lượt chạy đã hết hạn mức");
  await expect(quotaNotice(page).getByRole("button", { name: "Thử lại", exact: true })).toBeVisible();
  await expect(quotaNotice(page).getByRole("button", { name: "Tiếp tục bằng Codex", exact: true })).toHaveCount(0);
  await quotaNotice(page).getByRole("button", { name: "Để sau", exact: true }).click();
  await expect(quotaNotice(page)).toHaveCount(0);
  await expect(action(page)).toBeEnabled();
  expect(state.previews).toHaveLength(0);
  expect(state.commits).toHaveLength(0);
  expect(state.view.run!.sessionId).toBe(A);
});

for (const available of [true, false]) {
  test(`account exhaustion is labelled separately; quick Codex availability=${available} still needs preview`, async ({ page }) => {
    const state = await fake(page, { phase: "interrupted" });
    state.sessions[0].accountQuota = { scope: "account", agent: "claude", source: "claude-statusline", observedAt: Date.now(), freshness: "fresh", exhausted: true };
    await page.route("**/api/sessions/capabilities", (route) =>
      route.fulfill({
        json: { agents: [{ agent: "codex", cli: { status: available ? "supported" : "unsupported" }, login: { status: "supported" }, models: { status: "supported", items: [] } }] },
      }),
    );
    await page.reload();
    await expect(quotaNotice(page)).toContainText("Hạn mức tài khoản");
    await expect(quotaNotice(page)).toContainText("không phải bằng chứng nguyên nhân lỗi");
    await expect(quotaNotice(page)).toContainText("Chưa xác định được nguyên nhân");
    const quick = quotaNotice(page).getByRole("button", { name: "Tiếp tục bằng Codex", exact: true });
    if (available) {
      await expect(quick).toBeVisible();
      await quick.click();
      await expect(panel(page).getByRole("combobox", { name: "Agent", exact: true })).toHaveValue("codex");
      expect(state.previews).toHaveLength(0);
      await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
      await expect(panel(page).locator(".handoff-preview")).toBeVisible({ timeout: 15000 });
      await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
    } else {
      await expect(quick).toHaveCount(0);
      await quotaNotice(page).getByRole("button", { name: "Chọn agent khác", exact: true }).click();
      await expect(panel(page)).toBeVisible();
    }
    expect(state.commits).toHaveLength(0);
  });
}

test("old account quota and unknown failure keep manual handoff without quota actions", async ({ page }) => {
  const state = await fake(page, { phase: "interrupted" });
  state.sessions[0].failure = { ...quotaFailure(), reason: "unknown", evidence: { source: "unclassified" } };
  state.sessions[0].accountQuota = { scope: "account", agent: "claude", source: "claude-statusline", observedAt: Date.now() - 600_000, freshness: "stale", exhausted: true };
  await page.reload();
  await expect(quotaNotice(page)).toContainText("Chưa xác định được nguyên nhân");
  await expect(quotaNotice(page)).toContainText("đã cũ");
  await expect(quotaNotice(page).getByRole("button")).toHaveCount(0);
  await expect(action(page)).toBeEnabled();
  expect(state.commits).toHaveLength(0);
});

test("account suggestions expire at the reported reset without any session mutation", async ({ page }) => {
  const state = await fake(page, { phase: "interrupted" });
  await page.clock.install();
  state.sessions[0].accountQuota = {
    scope: "account",
    agent: "claude",
    source: "claude-statusline",
    observedAt: Date.now(),
    validUntil: Date.now() + 60_000,
    freshness: "fresh",
    exhausted: true,
  };
  await page.reload();
  await expect(quotaNotice(page).getByRole("button", { name: "Chọn agent khác", exact: true })).toBeVisible();
  await page.clock.fastForward(60_001);
  await expect(quotaNotice(page)).toContainText("đã cũ");
  await expect(quotaNotice(page).getByRole("button")).toHaveCount(0);
  await expect(action(page)).toBeEnabled();
  expect(state.commits).toHaveLength(0);
});

test("member quota suggestions open only the affected lane", async ({ page }) => {
  const state = await fake(page, { members: true });
  state.sessions[1].failure = quotaFailure();
  state.view.run!.subtasks![0].phase = "interrupted";
  await page.reload();
  await expect(quotaNotice(page)).toHaveCount(1);
  await quotaNotice(page).getByRole("button", { name: "Chọn agent khác", exact: true }).click();
  await expect(panel(page)).toContainText("Việc 1 · bước dispatch");
  expect(state.commits).toHaveLength(0);
});

for (const permission of ["none", "sibling", "stale-source"]) {
  test(`member handoff stays scoped with permission: ${permission}`, async ({ page }) => {
    const asking = permission === "sibling";
    const state = await fake(page, { members: true, asking });
    if (permission === "stale-source") {
      state.sessions[1].activity = "permission";
      await page.reload();
    }
    await expect(action(page)).toHaveCount(2); // No main, pending or done lane action.
    await page.locator(".subtask-row").first().getByRole("button", { name: "Tiếp tục bằng…" }).click();
    await expect(panel(page)).toContainText("Việc 1 · bước dispatch");
    await choose(page);
    await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
    await panel(page).getByRole("checkbox").check();
    await page.route("**/api/tasks/PROJ-1/run/handoff", (route) => {
      const request = route.request().postDataJSON() as HandoffCommitRequest;
      state.commits.push(request);
      const op = operation(request);
      state.view.run!.subtasks![0].sessionId = D;
      state.view.run!.handoffs = [op];
      state.view.run!.attempts = [
        { id: "attempt-new", scope: request.scope, sessionId: D, generation: 1, execution: { ...request.target, source: "lane-override", modelSource: "default" }, startedAt: 2 },
      ];
      if (permission !== "stale-source") state.sessions[1] = makeSession(B, { status: "exited", retired: { operationId: request.operationId, replacedBy: D, at: 2 } });
      state.sessions[3] = makeSession(D, { agent: "codex" });
      return route.fulfill({ json: { operation: op } });
    });
    await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    expect(state.commits).toHaveLength(1);
    expect(state.commits[0]).toMatchObject({ scope: { kind: "subtask", stepId: "dispatch", n: 1 }, target: { agent: "codex" }, confirmStop: true });
    await expect(tab(page)).toContainText(asking ? "Session c" : "Session d");
    await expect(page.locator(".subtask-row").first()).toContainText("Codex");
    await expect(page.locator(".subtask-row").first()).not.toContainText("haiku");
    await expect(page.locator(".subtask-row").nth(1)).toContainText("Claude");
  });
}

test("preview is invalidated on edits; preflight/stale errors stay visible and commit retries keep one operation id", async ({ page }) => {
  const state = await fake(page);
  await action(page).click();
  await choose(page);
  await panel(page).getByRole("combobox", { name: "Model", exact: true }).selectOption("gpt-6.1-sol");
  await expect(panel(page).locator(".handoff-preview")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
  await panel(page).getByRole("combobox", { name: "Agent", exact: true }).selectOption("copilot");
  await expect(panel(page).getByRole("combobox", { name: "Model", exact: true })).toHaveValue("");
  await page.route("**/api/tasks/PROJ-1/run/handoff/preview", (route) => route.fulfill({ status: 503, json: { error: "CLI unavailable: preflight" } }));
  await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("CLI unavailable");
  await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
  await page.unroute("**/api/tasks/PROJ-1/run/handoff/preview");
  // A fresh preview endpoint response; preserve the original handler by reinstalling only this route.
  await page.route("**/api/tasks/PROJ-1/run/handoff/preview", (route) =>
    route.fulfill({
      json: {
        preview: {
          id: "1".repeat(64),
          fingerprint: "2".repeat(64),
          sourceSessionId: A,
          expectedGeneration: 2,
          source: { agent: "claude" },
          target: { agent: "copilot" },
          text: "Fresh preview",
        },
        requiresConfirmation: true,
        preflight: { status: "ready", errors: [] },
      },
    }),
  );
  await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
  await panel(page).getByRole("checkbox").check();
  await page.route("**/api/tasks/PROJ-1/run/handoff", (route) => {
    state.commits.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: "Preview đã cũ; kiểm tra lại lane" } });
  });
  await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Preview đã cũ");
  await panel(page).getByRole("button", { name: "Kiểm tra / gửi lại xác nhận", exact: true }).click();
  await expect.poll(() => state.commits.length).toBe(2);
  expect(state.commits[0]).toEqual(state.commits[1]);
  await panel(page).getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
});

test("a committed response with prompt failure remains an error and recovery follows the durable target", async ({ page }) => {
  const state = await fake(page);
  await action(page).click();
  await choose(page);
  await panel(page).getByRole("checkbox").check();
  await page.route("**/api/tasks/PROJ-1/run/handoff", (route) => {
    const op = operation(route.request().postDataJSON(), { error: "Prompt delivery failed", promptState: "sending", cleanup: "complete", recovery: "interrupted" });
    state.view.run!.sessionId = D;
    state.view.run!.phase = "interrupted";
    state.view.run!.handoffs = [op];
    return route.fulfill({ json: { operation: op } });
  });
  await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("Prompt delivery failed");
  await panel(page).getByRole("button", { name: "Đóng", exact: true }).click();
  await page.locator(".handoff-history").getByText("Lịch sử bàn giao", { exact: true }).click();
  await expect(page.locator(".handoff-history")).toContainText("Thử lại ở đúng bước/việc để tiếp tục agent đích");
});

test("blocked recovery disables handoff/retry, and pre-commit failure explains recovery to the source", async ({ page }) => {
  const state = await fake(page, { phase: "interrupted" });
  state.view.run!.handoffs = [
    operation(
      { scope: { kind: "step", stepId: "work" }, target: { agent: "codex" }, operationId: "blocked", sourceSessionId: A, previewId: "p", fingerprint: "f", expectedGeneration: 1 },
      { stage: "failed", cleanup: "blocked", error: "Cannot confirm process exit" },
    ),
  ];
  await page.reload();
  await expect(action(page)).toBeDisabled();
  await expect(page.locator(".now-card").getByRole("button", { name: "Gửi lại bước", exact: true })).toHaveCount(0);
  await page.locator(".handoff-history").getByText("Lịch sử bàn giao", { exact: true }).click();
  await expect(page.locator(".handoff-history")).toContainText("Cannot confirm process exit");
  state.view.run!.handoffs![0].cleanup = "complete";
  await page.reload();
  await expect(action(page)).toBeEnabled();
  await page.locator(".handoff-history").getByText("Lịch sử bàn giao", { exact: true }).click();
  await expect(page.locator(".handoff-history")).toContainText("Phiên nguồn vẫn là lane hiện hành");
});

test("retired and reserved Codex history has no resume/input/approval; metrics retain partial coverage and provenance on mobile", async ({ page }) => {
  const state = await fake(page);
  state.sessions[0] = makeSession(A, { agent: "codex", status: "exited", retired: { operationId: "op", replacedBy: B, at: 2 } });
  state.sessions[1] = makeSession(B, { agent: "codex", reservation: { operationId: "op2", role: "target", at: 3 } });
  state.view.usage = {
    sessions: [
      {
        sessionId: A,
        agent: "claude",
        attemptIds: ["a"],
        scopes: [{ kind: "step", stepId: "work" }],
        actualModels: ["claude-actual"],
        measurements: [{ sessionId: A, source: "claude-statusline", basis: "session", observedAt: 1, metrics: { costUsd: 0.42 } }],
        metrics: { costUsd: 0.42 },
      },
      {
        sessionId: B,
        agent: "codex",
        attemptIds: ["b", "c"],
        scopes: [],
        actualModels: [],
        measurements: [{ sessionId: B, source: "codex-thread", basis: "thread", metrics: { inputTokens: 0, outputTokens: 20 } }],
        metrics: { inputTokens: 0, outputTokens: 20 },
      },
    ],
    totals: {},
    coverage: { costUsd: 1, inputTokens: 1, outputTokens: 1 },
  };
  // Retired and reserved Codex sessions are a PTY replay like any other: no conversation view.
  await page.routeWebSocket("**/api/sessions/*/pty", (socket) => {
    socket.onMessage((message) => {
      if (JSON.parse(String(message)).t === "r") socket.send(JSON.stringify({ t: "o", d: "Saved source output\r\n" }));
    });
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".drawer-session").first().click();
  const drawer = page.locator(".drawer");
  // xterm paints only while it is on screen, and on a phone the replay sits below the lane card.
  await drawer.locator(".xterm").scrollIntoViewIfNeeded();
  await expect(drawer.locator(".xterm")).toContainText("Saved source output");
  await expect(drawer.getByRole("button", { name: /Resume|Chấp nhận|Từ chối|Gửi \(/ })).toHaveCount(0);
  await expect(drawer).toContainText("Phiên đã được thay, chỉ xem lịch sử");
  await page.locator(".drawer-session").nth(1).click();
  await expect(drawer).toContainText("Phiên đang được giữ cho bàn giao/khôi phục");
  await expect(drawer.getByRole("button", { name: /Resume|Dừng|Chấp nhận/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: /^Terminal/ }).click();
  await page.getByText("Số liệu từ 2 session", { exact: true }).click();
  const usage = page.locator(".handoff-usage");
  await expect(usage).toContainText("Có số đo 1/2 session");
  await expect(usage).toContainText("Chưa có số đo");
  await expect(usage).toContainText("$0.42");
  await expect(usage).toContainText("Nguồn: Claude statusline");
  await expect(usage).toContainText("Nguồn: Codex thread");
  await expect(usage).toContainText("Token vào: 0");
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("an exited source commits without stop consent", async ({ page }) => {
  const state = await fake(page, { phase: "interrupted" });
  state.requiresConfirmation = false;
  state.sessions[0].status = "exited";
  await page.reload();
  await action(page).click();
  await choose(page);
  await expect(panel(page).getByRole("checkbox")).toHaveCount(0);
  await page.route("**/api/tasks/PROJ-1/run/handoff", (route) => {
    state.commits.push(route.request().postDataJSON());
    return route.fulfill({ json: { operation: operation(state.commits[0]) } });
  });
  await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.commits[0].confirmStop).toBe(false);
});

test("retired PTY replays history and typing sends no input frames", async ({ page }) => {
  const state = await fake(page);
  state.sessions[0] = makeSession(A, { status: "exited", retired: { operationId: "op", replacedBy: B, at: 2 } });
  const frames: Array<{ t: string }> = [];
  await page.routeWebSocket(`**/api/sessions/${A}/pty`, (socket) => {
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      frames.push(frame);
      if (frame.t === "r") socket.send(JSON.stringify({ t: "o", d: "Archived PTY output\r\n" }));
    });
  });
  await page.reload();
  await page.locator(".drawer-session").first().click();
  await expect(page.locator(".drawer .xterm")).toBeVisible();
  await expect.poll(() => frames.length).toBeGreaterThan(0);
  await page.locator(".drawer .xterm-helper-textarea").focus();
  await page.keyboard.type("should-not-send");
  await page.keyboard.press("Enter");
  expect(frames.some((frame) => frame.t === "i")).toBe(false);
  await expect(page.locator(".drawer").getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
});

for (const phase of ["done", "cancelled", "gate"] as const) {
  test(`no handoff at ${phase}`, async ({ page }) => {
    await fake(page, { phase });
    await expect(action(page)).toHaveCount(0);
  });
}

async function stopReal(page: Page) {
  await page.request.delete("/api/tasks/DEMO-1/run");
  const sessions: SessionView[] = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
  for (const session of sessions.filter((s) => s.status === "running")) await page.request.post(`/api/sessions/${session.id}/stop`);
}

async function transfer(page: Page, agent: string) {
  await action(page).first().click();
  await choose(page, agent);
  await panel(page).getByRole("checkbox").check();
  await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
  // Copilot preflight can spend several seconds probing its model inventory.
  await expect(panel(page)).toHaveCount(0, { timeout: 15000 });
}

for (const scenario of ["busy", "approval", "no-hook"]) {
  test(`real Claude ${scenario} requires consent and hands off manually without guessing quota`, async ({ page }) => {
    const repo = createSelectionRepo(`claude-${scenario}-${Date.now()}`, {
      settings: "mode: custom\n",
      workflow: `version: 2
agent: claude
permission-mode: acceptEdits
steps:
  - id: work
    prompt: prompt.md
    outputs: [{id: report, file: report.md}]
    done-when: report
    gate: approve
`,
    });
    writeFileSync(path.join(repo, ".taskpilot/prompt.md"), "Continue the manual fixture {{outputs}}");
    expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
    try {
      expect((await page.request.put("/api/env/FAKE_CLAUDE_SCENARIO", { data: { value: scenario } })).ok()).toBe(true);
      expect((await page.request.post("/api/tasks/DEMO-1/run", { data: { mode: "custom" } })).ok()).toBe(true);
      const log = path.join(repo, ".fake-claude.jsonl");
      await expect.poll(() => existsSync(log) && readFileSync(log, "utf8").includes("Continue the manual fixture")).toBe(true);
      await expect
        .poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/sessions")).json())[0]?.activity)
        .toBe(scenario === "approval" ? "permission" : scenario === "busy" ? "busy" : "idle");
      await page.goto("/#/tasks/DEMO-1");
      await expect(action(page)).toBeEnabled();
      await expect(quotaNotice(page)).toHaveCount(0);
      const before = (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run;
      const sources = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
      expect(sources).toHaveLength(1);
      expect(sources[0].failure).toBeUndefined();
      await action(page).click();
      await choose(page, "codex");
      await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
      expect(await (await page.request.get("/api/tasks/DEMO-1/sessions")).json()).toHaveLength(1);
      await panel(page).getByRole("checkbox").check();
      await panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
      await expect(panel(page)).toHaveCount(0);
      const after = (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run;
      const sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
      expect(after.stepIndex).toBe(before.stepIndex);
      expect(after.execution).toEqual(before.execution);
      expect(after.sessionId).not.toBe(before.sessionId);
      expect(sessions.find((s: SessionView) => s.id === before.sessionId)).toMatchObject({ status: "exited", retired: { replacedBy: after.sessionId } });
      await expect
        .poll(async () => {
          const current = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
          return current.find((s: SessionView) => s.id === after.sessionId);
        })
        .toMatchObject({ agent: "codex", nativeId: expect.any(String) });
      expect((await page.request.post(`/api/sessions/${before.sessionId}/resume`)).status()).toBe(409);
    } finally {
      await stopReal(page);
      await openFixtureRepo(page);
    }
  });
}

// A real Codex run no longer reports a typed quota failure: its TUI has no turn error to classify (REFACTOR-001, quotaDetection = unknown).
// The quota notice and its handoff actions stay covered by the faked-failure tests above.

test("real main Copilot → Codex → Copilot uses new sessions/native thread and keeps source read-only/history after reload", async ({ page }) => {
  const repo = createSelectionRepo(`handoff-main-${Date.now()}`);
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
  try {
    expect((await page.request.post("/api/tasks/DEMO-1/run", { data: { execution: { agent: "copilot" } } })).ok()).toBe(true);
    await page.goto("/#/tasks/DEMO-1");
    await expect(action(page)).toBeEnabled();
    const before = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    await transfer(page, "codex");
    const middle = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    expect(middle.run.stepIndex).toBe(before.run.stepIndex);
    expect(middle.run.sessionId).not.toBe(before.run.sessionId);
    await expect(tab(page)).toContainText("Codex");
    let sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
    expect(sessions.find((s: SessionView) => s.id === before.run.sessionId).retired.replacedBy).toBe(middle.run.sessionId);
    await expect
      .poll(async () => {
        const current = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
        return current.find((s: SessionView) => s.id === middle.run.sessionId)?.nativeId;
      })
      .toBeTruthy();
    expect((await page.request.post(`/api/sessions/${before.run.sessionId}/resume`)).status()).toBe(409);
    await transfer(page, "copilot");
    const after = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    expect(after.run.stepIndex).toBe(before.run.stepIndex);
    expect(after.run.sessionId).not.toBe(middle.run.sessionId);
    expect(after.run.handoffs).toHaveLength(2);
    await expect(tab(page)).toContainText("Copilot");
    await page.reload();
    await page.locator(".drawer-session").filter({ hasText: "Codex" }).click();
    await expect(page.locator(".drawer").getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
    // Codex history is the archived PTY, matching the current TUI backend.
    const replay = page.locator(".drawer .xterm");
    await replay.scrollIntoViewIfNeeded();
    await expect(replay).toContainText("TaskPilot handoff snapshot");
    expect(readFileSync(path.join(repo, ".claude/tasks/DEMO-1/00-history.md"), "utf8")).toContain(after.run.handoffs[0].operationId);
    sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
    expect(sessions.filter((s: SessionView) => s.retired)).toHaveLength(2);
  } finally {
    await stopReal(page);
    await openFixtureRepo(page);
  }
});

test("real member with pending approval hands off to Copilot, keeps dependent pending and does not change the leader", async ({ page }) => {
  const repo = createSelectionRepo(`handoff-member-${Date.now()}`, {
    settings: "mode: custom\n",
    workflow: `version: 2
agent: codex
permission-mode: acceptEdits
steps:
  - id: plan
    prompt: plan.md
    outputs: [{id: plan, file: 02-plan.md}]
    done-when: plan
    gate: approve
  - id: dispatch
    dispatch:
      from: plan
      prompt: member.md
      report: 03-viec-{{n}}.md
      parallel: 2
  - id: review
    prompt: review.md
    outputs: [{id: summary, file: 04-summary.md}]
    done-when: summary
    gate: approve
`,
  });
  for (const [file, text] of Object.entries({
    "plan.md": "WRITE:.claude/tasks/DEMO-1/02-plan.md PLAN_TABLE {{outputs}}",
    "member.md": "APPROVAL {{subtask}}",
    "review.md": "Review {{outputs}}",
  })) {
    mkdirSync(path.join(repo, ".taskpilot"), { recursive: true });
    writeFileSync(path.join(repo, ".taskpilot", file), text);
  }
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
  try {
    expect((await page.request.put("/api/env/FAKE_CODEX_TWO_MEMBERS", { data: { value: "two-members-fixture-enabled" } })).ok()).toBe(true);
    await page.goto("/#/tasks/DEMO-1");
    await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
    await page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true }).click();
    await expect(page.locator(".subtask-row").first()).toContainText("xin quyền");
    await expect(page.locator(".subtask-row").first().getByRole("button", { name: "Mở terminal để trả lời", exact: true })).toBeVisible();
    const before = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    await transfer(page, "copilot");
    const after = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    expect(after.run.sessionId).toBe(before.run.sessionId);
    expect(after.run.stepIndex).toBe(1);
    expect(after.run.subtasks[0].sessionId).not.toBe(before.run.subtasks[0].sessionId);
    expect(after.run.subtasks[0].agent).toBe("codex"); // Original assignment stays intact.
    expect(after.run.subtasks[1]).toMatchObject({ phase: "pending", deps: [1] });
    await expect(page.locator(".subtask-row").first()).toContainText("Copilot");
    await expect(tab(page)).toContainText("Copilot");
    expect((await page.request.post(`/api/sessions/${before.run.subtasks[0].sessionId}/resume`)).status()).toBe(409);
    await page.setViewportSize({ width: 390, height: 844 });
    await action(page).click();
    await choose(page, "codex");
    expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await panel(page).getByRole("button", { name: "Đóng", exact: true }).click();
  } finally {
    await stopReal(page);
    await openFixtureRepo(page);
  }
});

test("handoff shares all provider models and changing provider invalidates preview and consent", async ({ page }) => {
  await page.route("**/api/sessions/capabilities", (route) =>
    route.fulfill({
      json: {
        agents: ["claude", "copilot", "codex"].map((agent) => ({
          agent,
          cli: { status: "supported" },
          login: { status: "supported" },
          models: { status: "supported", items: [{ id: agent, model: `${agent}-model` }] },
        })),
      },
    }),
  );
  const state = await fake(page);
  await action(page).click();
  const agent = panel(page).getByRole("combobox", { name: "Agent", exact: true });
  const model = panel(page).getByRole("combobox", { name: "Model", exact: true });
  await expect.poll(() => agent.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))).toEqual(["claude", "copilot", "codex"]);
  for (const provider of ["claude", "copilot", "codex"]) {
    await agent.selectOption(provider);
    await expect(model).toHaveValue("");
    await model.selectOption(`${provider}-model`);
    await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
    await expect(panel(page).locator(".handoff-preview")).toBeVisible({ timeout: 15000 });
    expect(state.previews.at(-1)?.target).toEqual({ agent: provider, model: `${provider}-model` });
    await panel(page).getByRole("checkbox").check();
    await agent.selectOption(provider === "codex" ? "claude" : "codex");
    await expect(model).toHaveValue("");
    await expect(panel(page).locator(".handoff-preview")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Xác nhận bàn giao", exact: true })).toBeDisabled();
  }
  expect(state.commits).toHaveLength(0);
});

for (const failed of [false, true]) {
  test(`handoff preserves saved model with unknown capability or request error=${failed}`, async ({ page }) => {
    await page.route("**/api/sessions/capabilities", (route) =>
      route.fulfill(
        failed
          ? { status: 503, json: { error: "Inventory unavailable" } }
          : { json: { agents: [{ agent: "claude", cli: { status: "unknown" }, login: { status: "unknown" }, models: { status: "unknown", items: [] } }] } },
      ),
    );
    const state = await fake(page, { members: true });
    await action(page).first().click();
    const model = panel(page).getByRole("combobox", { name: "Model", exact: true });
    await expect(model).toHaveValue("haiku");
    await expect(model.locator('option[value="haiku"]')).toHaveAttribute("disabled", "");
    if (failed) await expect(panel(page).getByRole("alert")).toContainText("Inventory unavailable", { timeout: 20000 });
    await panel(page).getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
    await expect(panel(page).locator(".handoff-preview")).toBeVisible({ timeout: 15000 });
    expect(state.previews.at(-1)?.target).toEqual({ agent: "claude", model: "haiku" });
    expect(state.commits).toHaveLength(0);
  });
}
