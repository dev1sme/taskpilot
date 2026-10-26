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

/** Opens a Codex session from the drawer; its TUI (the stand-in) shows the input-box footer when it is ready. */
async function createSession(page: Page) {
  const drawer = page.locator("main .drawer");
  await drawer.getByRole("button", { name: "Session mới", exact: true }).click();
  await drawer.getByRole("button", { name: /Codex/ }).click();
  await expect(drawer.locator(".xterm")).toContainText("gpt-6.1-sol default");
  return drawer;
}

/** Types into the session's terminal like a user: focus xterm, then keys. */
async function typeLine(page: Page, text: string) {
  await page.locator("main .drawer .xterm-helper-textarea").focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Pastes text into xterm as a browser paste event; the TUI asked for bracketed paste, so it arrives as one block. */
async function pasteLines(page: Page, text: string) {
  await page.locator("main .drawer .xterm-helper-textarea").focus();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await page.keyboard.press("Enter");
}

test("terminal session: multiline prompt, stop, resume the same thread and reload", async ({ page }) => {
  let drawer = await createSession(page);
  await pasteLines(page, "PELICAN-42\nSecond line");
  await expect(drawer.locator(".xterm")).toContainText("› PELICAN-42");
  await expect(drawer.locator(".xterm")).toContainText("• DONE");
  const sessions = async () =>
    (await (await page.request.get("/api/tasks/CODEX-1/sessions")).json()) as Array<{ id: string; agent: string; status: string; generation?: number; activity?: string; nativeId?: string }>;
  // The thread id arrives with the first hook, so the session can be resumed.
  await expect.poll(async () => (await sessions())[0]?.nativeId).toBeTruthy();
  const nativeId = (await sessions())[0].nativeId;

  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Resume", exact: true }).click();
  // The terminal replays the first run's footer, so wait for the second process to reach its input box.
  await expect.poll(async () => (await sessions())[0]).toMatchObject({ status: "running", generation: 2, activity: "idle" });
  await typeLine(page, "RECALL");
  // The resumed thread answers with the first prompt: same thread, not a new one.
  await expect(drawer.locator(".xterm")).toContainText("• PELICAN-42");
  expect((await sessions())[0]).toMatchObject({ agent: "codex", status: "running", nativeId });

  await page.reload();
  drawer = page.locator("main .drawer");
  await drawer.locator(".drawer-session").last().click();
  await expect(drawer.locator(".xterm")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer.locator(".xterm")).toBeVisible();
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
});

test("an approval is answered in the terminal, a refusal too, and Esc interrupts a running tool", async ({ page }) => {
  const drawer = await createSession(page);
  const activity = async () => (await (await page.request.get("/api/tasks/CODEX-1/sessions")).json())[0].activity;

  await typeLine(page, "APPROVAL");
  await expect.poll(activity).toBe("permission");
  await expect(drawer.locator(".xterm")).toContainText("Would you like to run the following command?");
  await page.keyboard.press("y");
  await expect(drawer.locator(".xterm")).toContainText("• APPROVED");
  await expect.poll(activity).toBe("idle");

  await typeLine(page, "APPROVAL");
  await expect.poll(activity).toBe("permission");
  await page.keyboard.press("Escape");
  await expect(drawer.locator(".xterm")).toContainText("• DECLINED");
  await expect.poll(activity).toBe("idle");

  await typeLine(page, "SLOW");
  await expect.poll(activity).toBe("busy");
  await page.keyboard.press("Escape");
  await expect(drawer.locator(".xterm")).toContainText("Conversation interrupted");
  await expect.poll(activity).toBe("idle");
  await drawer.getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
});

test("workflow gates, feedback, Codex member and its approval answered in the terminal", async ({ page }) => {
  await expect(page.getByText("Repo chưa có subagent nào làm được việc con", { exact: false })).toHaveCount(0);
  await page.locator(".now-card").getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  await page.getByPlaceholder("Ví dụ: thêm test cho trường hợp danh sách rỗng").fill("Review again");
  await page.getByRole("button", { name: "Gửi góp ý", exact: true }).click();
  await expect(page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true }).click();
  // The member asks for approval in its TUI: the card has no buttons of its own, only a way to the terminal.
  const card = page.locator(".now-card");
  await expect(card.getByRole("button", { name: "Mở terminal để trả lời", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Chấp nhận", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Mở terminal để trả lời", exact: true }).click();
  await expect(page.locator("main .drawer .xterm")).toContainText("Would you like to run the following command?");
  await page.locator("main .drawer .xterm-helper-textarea").focus();
  await page.keyboard.press("y");
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
  await page.locator(".now-card").getByRole("button", { name: "Mở terminal để trả lời", exact: true }).click();
  await expect(page.locator("main .drawer .xterm")).toContainText("Would you like to run the following command?");
  await page.locator("main .drawer .xterm-helper-textarea").focus();
  await page.keyboard.press("y");
  await page.getByRole("button", { name: "Duyệt và hoàn tất", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run.phase).toBe("done");
  const final = (await (await page.request.get("/api/tasks/CODEX-1/run")).json()).run;
  expect(final.handoffs).toHaveLength(1);
  expect(final.subtasks[0]).toMatchObject({ agent: "codex", phase: "done" });
});
