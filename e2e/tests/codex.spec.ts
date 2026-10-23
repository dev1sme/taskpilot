import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TMP, E2E_USER, E2E_PASSWORD } from "../env";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }, info) => {
  if (!(await (await page.request.get("/api/auth")).json()).authenticated) {
    expect((await page.request.post("/api/login", { data: { user: E2E_USER, password: E2E_PASSWORD } })).ok()).toBe(true);
  }
  const repo = path.join(TMP, "repos", `codex-${info.testId.replace(/\W/g, "")}`);
  const files = {
    ".claude/tasks/CODEX-1/spec/README.md": "# Codex test\n",
    ".taskpilot/workflow.yml": `version: 2
agent: codex
permission-mode: acceptEdits
steps:
  - id: plan
    prompt: plan.md
    outputs: [{id: plan, file: 02-plan.md}]
    done-when: plan
    gate: approve
    on-reject: feedback.md
  - id: dispatch
    dispatch:
      from: plan
      prompt: member.md
      report: 03-viec-{{n}}.md
      parallel: 1
  - id: review
    prompt: review.md
    outputs: [{id: summary, file: 04-summary.md}]
    done-when: summary
    gate: approve
`,
    ".taskpilot/plan.md": "WRITE:.claude/tasks/CODEX-1/02-plan.md PLAN_TABLE {{outputs}}",
    ".taskpilot/feedback.md": "WRITE:.claude/tasks/CODEX-1/02-plan.md PLAN_TABLE {{feedback}}",
    ".taskpilot/member.md": "APPROVAL WRITE:.claude/tasks/CODEX-1/03-viec-1.md {{subtask}}",
    ".taskpilot/review.md": "WRITE:.claude/tasks/CODEX-1/04-summary.md {{outputs}}",
  };
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(repo, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
  await page.goto("/#/tasks/CODEX-1");
});

async function createSession(page: Page) {
  const drawer = page.locator("main .drawer");
  await drawer.getByRole("button", { name: "Session mới", exact: true }).click();
  await drawer.getByRole("button", { name: /Codex/ }).click();
  await expect(drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" })).toBeEnabled();
  return drawer;
}

test("multiline conversation, replay, stop/resume and mobile layout", async ({ page }) => {
  let drawer = await createSession(page);
  const prompt = "PELICAN-42\nSecond line";
  await drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" }).fill(prompt);
  await drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" }).press("Control+Enter");
  await expect(drawer.locator(".conversation-agent")).toContainText("DONE");
  await expect(drawer.locator(".conversation-user")).toContainText(prompt);
  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Resume", exact: true }).click();
  await drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" }).fill("RECALL");
  await drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" }).press("Control+Enter");
  await expect(drawer.locator(".conversation-agent").last()).toContainText(prompt);
  await page.reload();
  drawer = page.locator("main .drawer");
  await drawer.locator(".drawer-session").last().click();
  await expect(drawer.locator(".conversation-agent").last()).toContainText(prompt);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" })).toBeVisible();
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
});

test("explicit approvals, rejection and interrupt", async ({ page }) => {
  const drawer = await createSession(page);
  const input = drawer.getByRole("textbox", { name: "Yêu cầu cho Codex" });
  for (const decision of ["Chấp nhận", "Từ chối"]) {
    await input.fill("APPROVAL");
    await input.press("Control+Enter");
    const approval = drawer.locator(".conversation-approval").last();
    await expect(approval.getByRole("button", { name: decision, exact: true })).toBeEnabled();
    await approval.getByRole("button", { name: decision, exact: true }).click();
    await expect(drawer.locator(".conversation-agent").last()).toContainText(decision === "Chấp nhận" ? "APPROVED" : "DECLINED");
  }
  await input.fill("SLOW");
  await input.press("Control+Enter");
  await drawer.getByRole("button", { name: "Ngắt lượt", exact: true }).click();
  await expect(drawer.locator(".conversation-tool").last()).toContainText("Đã hủy");
  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
});

test("workflow gates, feedback, Codex member and approval from NowCard", async ({ page }) => {
  await expect(page.getByText("Repo chưa có subagent nào làm được việc con", { exact: false })).toHaveCount(0);
  await page.locator(".now-card").getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  await page.getByPlaceholder("Ví dụ: thêm test cho trường hợp danh sách rỗng").fill("Review again");
  await page.getByRole("button", { name: "Gửi góp ý", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true }).click();
  const card = page.locator(".now-card");
  await expect(card.getByRole("button", { name: "Chấp nhận", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Chấp nhận", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt và hoàn tất", exact: true })).toBeVisible();
  const view = await (await page.request.get("/api/tasks/CODEX-1/run")).json();
  expect(view.run.subtasks[0]).toMatchObject({ agent: "codex", phase: "done", metrics: { inputTokens: 100, outputTokens: 20 } });
  await page.getByRole("button", { name: "Duyệt và hoàn tất", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run.phase).toBe("done");
});

test("an exited Claude lane hands off to a fresh Codex thread and completes feedback, member and review gates", async ({ page }) => {
  const repo = (await (await page.request.get("/api/repo")).json()).path;
  const workflow = path.join(repo, ".taskpilot/workflow.yml");
  writeFileSync(workflow, readFileSync(workflow, "utf8").replace("  - id: plan\n", "  - id: plan\n    agent: claude\n"));
  expect((await page.request.put("/api/env/FAKE_CLAUDE_SCENARIO", { data: { value: "busy" } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run?.phase).toBe("running");
  const before = (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run;
  expect((await page.request.post(`/api/sessions/${before.sessionId}/stop`)).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run.phase).toBe("interrupted");
  await page.locator(".now-card").getByRole("button", { name: "Tiếp tục bằng…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Agent", exact: true }).selectOption("codex");
  await dialog.getByRole("button", { name: "Xem trước bàn giao", exact: true }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Xác nhận bàn giao", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  const after = (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run;
  const sessions = await (await page.request.get("/api/tasks/CODEX-1/sessions")).json();
  const source = sessions.find((s: { id: string }) => s.id === before.sessionId);
  const target = sessions.find((s: { id: string }) => s.id === after.sessionId);
  expect(source).toMatchObject({ agent: "claude", status: "exited", retired: { replacedBy: target.id } });
  expect(target.agent).toBe("codex");
  expect(target.nativeId).toBeTruthy();
  expect(target.nativeId).not.toBe(source.nativeId ?? source.id);
  expect(after.stepIndex).toBe(before.stepIndex);
  expect(after.previous).toBeUndefined();
  expect((await page.request.post(`/api/sessions/${source.id}/resume`)).status()).toBe(409);
  await page.getByPlaceholder("Ví dụ: thêm test cho trường hợp danh sách rỗng").fill("Verify handoff feedback");
  await page.getByRole("button", { name: "Gửi góp ý", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true }).click();
  await page.locator(".now-card").getByRole("button", { name: "Chấp nhận", exact: true }).click();
  await page.getByRole("button", { name: "Duyệt và hoàn tất", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run.phase).toBe("done");
  const final = (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run;
  expect(final.handoffs).toHaveLength(1);
  expect(final.subtasks[0]).toMatchObject({ agent: "codex", phase: "done" });
});
