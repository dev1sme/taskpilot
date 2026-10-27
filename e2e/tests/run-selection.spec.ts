import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSelectionRepo, openFixtureRepo } from "../fixtures/repo";

// The server has one current repo. Run this targeted file with --workers=1, apart from shared fixtures.
test.describe.configure({ mode: "serial" });
const picker = (page: Page) => page.locator(".run-options");
const agent = (page: Page) => picker(page).getByRole("combobox", { name: "Agent", exact: true });
const model = (page: Page) => picker(page).getByRole("combobox", { name: "Model", exact: true });
const mode = (page: Page) => picker(page).getByRole("combobox", { name: "Cách chạy", exact: true });

async function open(page: Page, repo: string) {
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
  await page.goto("/#/tasks/DEMO-1");
  await expect(agent(page)).toBeEnabled();
}

async function switchRepo(page: Page, repo: string) {
  await page.locator(".repo-switch").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Đường dẫn repo").fill(repo);
  await dialog.getByRole("button", { name: "Mở repo" }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/#/tasks/DEMO-1");
  await expect(agent(page)).toBeEnabled();
}

async function stop(page: Page) {
  await page.request.delete("/api/tasks/DEMO-1/run");
  const sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
  for (const session of sessions) await page.request.post(`/api/sessions/${session.id}/stop`);
}

test.afterEach(async ({ page }) => {
  await stop(page);
});
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  // Restore the shared fixture for other targeted regression files in this project.
  await openFixtureRepo(page);
  await page.close();
});

test("independent selectors, default model reset, preview and actual Codex launch", async ({ page }) => {
  const repo = createSelectionRepo("independent");
  await open(page, repo);
  await expect(agent(page)).toHaveValue("workflow");
  await expect(model(page)).toBeDisabled();
  await mode(page).selectOption("leader");
  await agent(page).selectOption("codex");
  await model(page).selectOption("gpt-6.1-sol");
  await mode(page).selectOption("default");
  await expect(agent(page)).toHaveValue("codex");
  await expect(model(page)).toHaveValue("gpt-6.1-sol");
  await agent(page).selectOption("copilot");
  await expect(model(page)).toHaveValue("");
  await expect(model(page).locator("option")).toHaveCount(1);
  await agent(page).selectOption("claude");
  await expect(model(page).locator("option")).toHaveCount(1);
  await agent(page).selectOption("codex");
  await picker(page).getByRole("button", { name: "Xem trước cấu hình hiệu lực", exact: true }).click();
  const preview = picker(page).locator(".run-options-preview");
  await expect(preview).toContainText("Claude / Mặc định của agent → Codex / Mặc định của agent");
  await expect(preview).toContainText("quyền: default");
  expect(readFileSync(path.join(repo, ".taskpilot/settings.yml"), "utf8")).not.toContain("execution:");
  await model(page).selectOption("gpt-6.1-sol");
  await expect(preview).toHaveCount(0);
  const sent = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/DEMO-1/run"));
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ mode: "default", execution: { agent: "codex", model: "gpt-6.1-sol" } });
  await expect.poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/sessions")).json())[0]?.agent).toBe("codex");
  const sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
  expect(sessions[0].model).toBe("gpt-6.1-sol");
});

test("workflow policy launches all three fake CLIs with their own YAML models and real output gates", async ({ page }) => {
  const repo = createSelectionRepo("mixed-clis", {
    settings: "mode: custom\n",
    workflow: `version: 2
permission-mode: acceptEdits
steps:
  - id: claude
    agent: claude
    model: sonnet
    prompt: claude.md
    outputs: [{id: first, file: first.md}]
    done-when: first
    gate: approve
  - id: copilot
    agent: copilot
    model: copilot-yaml-model
    prompt: copilot.md
    outputs: [{id: second, file: second.md}]
    done-when: second
    gate: approve
  - id: codex
    agent: codex
    prompt: codex.md
    outputs: [{id: third, file: third.md}]
    done-when: third
    gate: approve
`,
  });
  for (const [agent, output] of [
    ["claude", "first"],
    ["copilot", "second"],
    ["codex", "third"],
  ]) {
    writeFileSync(path.join(repo, ".taskpilot", `${agent}.md`), `WRITE:.claude/tasks/DEMO-1/${output}.md {{outputs}}`);
  }
  await open(page, repo);
  for (const name of ["FAKE_CLAUDE_SCENARIO", "FAKE_COPILOT_SCENARIO"]) {
    expect((await page.request.put(`/api/env/${name}`, { data: { value: "complete" } })).ok()).toBe(true);
  }
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  for (const [index, expected] of ["claude", "copilot", "codex"].entries()) {
    await expect
      .poll(async () => {
        const { run } = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
        return run ? { stepIndex: run.stepIndex, phase: run.phase } : null;
      })
      .toEqual({ stepIndex: index, phase: "gate" });
    const { run } = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
    const sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
    expect(sessions.find((s: { id: string }) => s.id === run.sessionId).agent).toBe(expected);
    await page.getByRole("button", { name: index === 2 ? "Duyệt và hoàn tất" : "Duyệt, sang bước tiếp", exact: true }).click();
  }
  await expect.poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run.phase).toBe("done");
  for (const [agent, selected] of [
    ["claude", "sonnet"],
    ["copilot", "copilot-yaml-model"],
  ]) {
    const launches = readFileSync(path.join(repo, `.fake-${agent}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(launches[0].args).toEqual(expect.arrayContaining(["--model", selected]));
    expect(launches.some((entry) => entry.text?.includes(`WRITE:.claude/tasks/DEMO-1/${agent === "claude" ? "first" : "second"}.md`))).toBe(true);
  }
  expect(readFileSync(path.join(repo, ".claude/tasks/DEMO-1/third.md"), "utf8")).toContain("Report");
});

test("intentional repo defaults, mode-only preservation, reload, task reset and repo cache isolation", async ({ page }) => {
  const first = createSelectionRepo("defaults-a");
  const second = createSelectionRepo("defaults-b", { settings: "mode: leader\nexecutionVersion: 1\nexecution: { agent: copilot }\n" });
  await open(page, first);
  await agent(page).selectOption("codex");
  await model(page).selectOption("gpt-6.1-sol");
  expect((await (await page.request.get("/api/config/workflow/execution-defaults")).json()).execution).toBeNull();
  await picker(page).getByRole("button", { name: "Dùng agent/model làm mặc định repo", exact: true }).click();
  await expect(picker(page).getByRole("status")).toContainText("Đã lưu agent/model");
  const settings = readFileSync(path.join(first, ".taskpilot/settings.yml"), "utf8");
  expect(settings).toContain("future: { keep: true }");
  expect(settings).toContain("mode: default");
  await mode(page).selectOption("leader");
  await picker(page).getByRole("button", { name: "Dùng cách chạy làm mặc định repo", exact: true }).click();
  await expect(picker(page).getByRole("status")).toContainText("Đã lưu cách chạy");
  expect((await (await page.request.get("/api/config/workflow/execution-defaults")).json()).execution).toEqual({ agent: "codex", model: "gpt-6.1-sol" });
  await page.reload();
  await expect(agent(page)).toHaveValue("codex");
  await expect(mode(page)).toHaveValue("leader");
  await expect(model(page)).toHaveValue("gpt-6.1-sol");
  await agent(page).selectOption("claude");
  await page.goto("/#/tasks/DEMO-2");
  await expect(agent(page)).toHaveValue("codex");
  await switchRepo(page, second);
  await expect(agent(page)).toHaveValue("copilot");
  await expect(model(page)).toHaveValue("");
  await switchRepo(page, first);
  await expect(agent(page)).toHaveValue("codex");
  await expect(model(page)).toHaveValue("gpt-6.1-sol");
  // Explicit workflow overrides the repo default without rewriting it.
  await agent(page).selectOption("workflow");
  const request = page.waitForRequest((request) => request.url().endsWith("/run/preview"));
  await picker(page).getByRole("button", { name: "Xem trước cấu hình hiệu lực", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ mode: "leader", execution: { agent: "workflow" } });
  await expect(picker(page).locator(".run-options-preview")).toContainText("Claude");
  await page.goto("/#/workflow");
  const configPreview = page.locator(".wf-preview");
  await expect(configPreview).toContainText("không áp dụng mặc định agent/model của repo");
  const render = page.waitForRequest((request) => request.url().endsWith("/api/config/workflow/render"));
  await configPreview.getByRole("button", { name: "Xem prompt", exact: true }).click();
  expect((await render).postDataJSON().execution).toEqual({ agent: "workflow" });
  await expect(configPreview).toContainText("Cấu hình yêu cầu hiệu lực: Claude");
});

test("a delayed preview response from the old repo cannot populate the new task form", async ({ page }) => {
  const first = createSelectionRepo("delayed-a");
  const second = createSelectionRepo("delayed-b", { settings: "mode: default\nexecutionVersion: 1\nexecution: { agent: copilot }\n" });
  await open(page, first);
  await agent(page).selectOption("codex");
  let release!: () => void;
  let ready!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let completed!: () => void;
  const responded = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route("**/run/preview", async (route) => {
    const response = await route.fetch();
    ready();
    await pending;
    await route.fulfill({ response });
    completed();
  });
  await picker(page).getByRole("button", { name: "Xem trước cấu hình hiệu lực", exact: true }).click();
  await received;
  try {
    await switchRepo(page, second);
    await expect(agent(page)).toHaveValue("copilot");
  } finally {
    release();
  }
  await responded;
  await expect(agent(page)).toHaveValue("copilot");
  await expect(picker(page).locator(".run-options-preview")).toHaveCount(0);
  await expect(model(page)).toHaveValue("");
});

test("stale defaults and invalid settings stay visible and never silently overwrite", async ({ page }) => {
  const repo = createSelectionRepo("stale");
  await open(page, repo);
  await agent(page).selectOption("copilot");
  const file = path.join(repo, ".taskpilot/settings.yml");
  writeFileSync(file, "mode: leader\nfuture: { keep: changed }\n");
  await picker(page).getByRole("button", { name: "Dùng agent/model làm mặc định repo", exact: true }).click();
  await expect(picker(page).getByRole("alert")).toBeVisible();
  expect(readFileSync(file, "utf8")).not.toContain("execution:");
  await expect(agent(page)).toHaveValue("copilot");
  writeFileSync(file, "mode: default\nexecutionVersion: 99\nexecution: { agent: codex, future: unknown }\n");
  await picker(page).getByRole("button", { name: "Tải lại cấu hình", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bắt đầu quy trình", exact: true })).toBeDisabled();
  await expect(picker(page).getByRole("alert").last()).toBeVisible();
});

test("Copilot uses fake readiness/hooks and interrupted restart sends every displayed field", async ({ page }) => {
  const repo = createSelectionRepo("copilot");
  await open(page, repo);
  await agent(page).selectOption("copilot");
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run?.phase).toBe("waiting");
  expect(readFileSync(path.join(repo, ".fake-copilot.jsonl"), "utf8")).toContain("text");
  const run = (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run;
  await page.request.post(`/api/sessions/${run.sessionId}/stop`);
  await expect(page.locator(".now-card")).toContainText(/gián đoạn/i);
  await expect(agent(page)).toHaveValue("copilot");
  await agent(page).selectOption("codex");
  await model(page).selectOption("gpt-6.1-sol");
  await mode(page).selectOption("leader");
  const request = page.waitForRequest((request) => request.url().endsWith("/run/restart"));
  await page.locator(".now-card").getByRole("button", { name: "Chạy lại từ đầu", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ mode: "leader", execution: { agent: "codex", model: "gpt-6.1-sol" } });
  await expect.poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run?.execution).toEqual({ agent: "codex", model: "gpt-6.1-sol" });
});

test("toolbar restart restores the run selection despite new repo defaults and reports failures", async ({ page }) => {
  const repo = createSelectionRepo("toolbar");
  await open(page, repo);
  await agent(page).selectOption("copilot");
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/tasks/DEMO-1/run")).json()).run?.phase).toBe("waiting");
  const defaults = await (await page.request.get("/api/config/workflow/execution-defaults")).json();
  await page.request.put("/api/config/workflow/execution-defaults", { data: { execution: { agent: "claude" }, baseHash: defaults.hash } });
  await page.reload();
  await page.locator(".toolbar").getByRole("button", { name: "Chạy lại từ đầu", exact: true }).click();
  await expect(agent(page)).toHaveValue("copilot");
  await agent(page).selectOption("codex");
  await model(page).selectOption("gpt-6.1-sol");
  await page.route("**/run/restart", (route) => route.fulfill({ status: 503, json: { error: "Preflight refused" } }));
  await page.getByRole("button", { name: "Xác nhận chạy lại", exact: true }).click();
  await expect(page.locator(".task-error")).toHaveText("Preflight refused");
  await page.unroute("**/run/restart");
  await expect(agent(page)).toHaveValue("codex");
  await agent(page).selectOption("workflow");
  const request = page.waitForRequest((request) => request.url().endsWith("/run/restart"));
  // Inspect a real payload without starting Claude, whose fixture intentionally only echoes input.
  await page.route("**/run/restart", (route) => route.fulfill({ status: 503, json: { error: "Stopped after payload assertion" } }));
  await page.getByRole("button", { name: "Xác nhận chạy lại", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ mode: "default", execution: { agent: "workflow" } });

  // A legacy run's missing execution means workflow, even after a repo default was added.
  let legacyPhase = "waiting";
  await page.route("**/api/tasks/DEMO-1/run", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const view = await response.json();
    delete view.run.execution;
    delete view.run.executionSnapshot;
    view.run.phase = legacyPhase;
    return route.fulfill({ json: view });
  });
  await page.reload();
  await page.locator(".toolbar").getByRole("button", { name: "Chạy lại từ đầu", exact: true }).click();
  await expect(agent(page)).toHaveValue("workflow");
  legacyPhase = "interrupted";
  await page.reload();
  await expect(agent(page)).toHaveValue("workflow");
  const legacyRequest = page.waitForRequest((request) => request.url().endsWith("/run/restart"));
  await page.locator(".now-card").getByRole("button", { name: "Chạy lại từ đầu", exact: true }).click();
  expect((await legacyRequest).postDataJSON()).toEqual({ mode: "default", execution: { agent: "workflow" } });
});

test("custom plan permission blocks Codex preview and keeps workflow unchanged", async ({ page }) => {
  const workflow =
    "version: 2\nagent: claude\npermission-mode: plan\nsteps:\n  - id: plan\n    prompt: prompt.md\n    outputs: [{id: plan, file: 02-plan.md}]\n    done-when: plan\n    gate: approve\n";
  const repo = createSelectionRepo("permission", { workflow });
  await open(page, repo);
  await mode(page).selectOption("custom");
  await agent(page).selectOption("codex");
  await picker(page).getByRole("button", { name: "Xem trước cấu hình hiệu lực", exact: true }).click();
  await expect(picker(page).getByRole("alert").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Bắt đầu quy trình", exact: true })).toBeDisabled();
  expect(readFileSync(path.join(repo, ".taskpilot/workflow.yml"), "utf8")).toBe(workflow);
  expect(await (await page.request.get("/api/tasks/DEMO-1/sessions")).json()).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("built-in Leader applies Codex default to main, members and review; done restart keeps requested default", async ({ page }) => {
  const repo = createSelectionRepo("leader");
  await open(page, repo);
  const log = path.join(repo, "rpc.jsonl");
  for (const [key, value] of Object.entries({ FAKE_CODEX_WORKFLOW: "1", FAKE_CODEX_LOG: log })) {
    expect((await page.request.put(`/api/env/${key}`, { data: { value } })).ok()).toBe(true);
  }
  await mode(page).selectOption("leader");
  await agent(page).selectOption("codex");
  await picker(page).getByRole("button", { name: "Xem trước cấu hình hiệu lực", exact: true }).click();
  await expect(picker(page).locator(".run-options-preview li")).toHaveCount(3);
  await page.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  await expect(page.locator(".gate-card")).toContainText("Cấu hình yêu cầu hiệu lực: Codex · Mặc định của agent");
  await expect(page.locator(".gate-card")).toContainText("Report");
  await page.getByRole("button", { name: "Duyệt, sang bước tiếp", exact: true }).click();
  await expect
    .poll(async () => {
      const view = await (await page.request.get("/api/tasks/DEMO-1/run")).json();
      return [view.run?.stepIndex, view.run?.phase];
    })
    .toEqual([2, "gate"]);
  const sessions = await (await page.request.get("/api/tasks/DEMO-1/sessions")).json();
  expect(sessions.length).toBeGreaterThanOrEqual(2); // The leader reuses its session for review.
  expect(sessions.every((session: { agent: string }) => session.agent === "codex")).toBe(true);
  const rpc = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const launches = rpc.filter((entry) => entry.method === "thread/start");
  expect(launches.length).toBeGreaterThanOrEqual(2);
  expect(launches.every((entry) => entry.params.model == null)).toBe(true);
  const turns = rpc.filter((entry) => entry.method === "turn/start");
  expect(turns.length).toBeGreaterThanOrEqual(3);
  expect(turns.every((entry) => entry.params.model == null)).toBe(true);
  await page.getByRole("button", { name: "Duyệt và hoàn tất", exact: true }).click();
  // New-run defaults change independently; restart must retain the finished run's mode.
  expect((await page.request.put("/api/config/workflow/mode", { data: { mode: "default" } })).ok()).toBe(true);
  await expect(agent(page)).toHaveValue("codex");
  await expect(model(page)).toHaveValue("");
  await page.reload();
  await expect(mode(page)).toHaveValue("leader");
  await expect(agent(page)).toHaveValue("codex");
  await expect(model(page)).toHaveValue("");
  await agent(page).selectOption("copilot");
  await page.route("**/run/restart", (route) => route.fulfill({ status: 503, json: { error: "Inspect done restart" } }));
  const request = page.waitForRequest((request) => request.url().endsWith("/run/restart"));
  await page.locator(".now-card").getByRole("button", { name: "Chạy lại từ đầu", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ mode: "leader", execution: { agent: "copilot" } });
});
