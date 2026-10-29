import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createGitRepo, gitIn } from "../fixtures/repo";

async function openRepo(page: Page, repo: string) {
  expect((await page.request.put("/api/repo", { data: { path: repo } })).ok()).toBe(true);
}

async function runOf(page: Page) {
  return (await (await page.request.get("/api/tasks/WT-1/run")).json()).run;
}

/** Cancels the run and stops its session, so its worktree can be integrated or removed. */
async function stopRun(page: Page) {
  const run = await runOf(page);
  expect((await page.request.delete("/api/tasks/WT-1/run")).ok()).toBe(true);
  expect((await page.request.post(`/api/sessions/${run.sessionId}/stop`)).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get("/api/tasks/WT-1/sessions")).json())[0].status).toBe("exited");
}

test("a run started in its own worktree leaves the repo untouched and lists its worktree", async ({ page }) => {
  const repo = createGitRepo("start");
  await openRepo(page, repo);
  await page.goto("/#/tasks/WT-1");
  await page.getByLabel("Chạy trong Git worktree riêng").check();
  await page.getByRole("button", { name: "Bắt đầu quy trình" }).click();

  const panel = page.getByRole("region", { name: "Worktree của run" });
  await expect(panel.getByText(/^taskpilot\/WT-1-/)).toBeVisible();
  await expect(panel.getByText("Chờ tích hợp")).toBeVisible();
  await expect(panel.getByText("Run đang chạy")).toBeVisible();
  const run = await runOf(page);
  expect(run.runId).toBeTruthy();
  expect(existsSync(path.join(run.workspace.cwd, "src", "app.txt"))).toBe(true);
  // The Git-ignored task folder stays in the repo; it is not carried into the worktree.
  expect(existsSync(path.join(run.workspace.cwd, ".claude", "tasks"))).toBe(false);
  expect(gitIn(repo, "status", "--porcelain")).toBe("");
  // While the run is active, integrate and remove are not offered.
  await expect(panel.getByRole("button", { name: "Tích hợp", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Dọn worktree" })).toBeDisabled();

  await stopRun(page);
  await page.reload();
  await panel.getByRole("button", { name: "Dọn worktree" }).click();
  await expect(panel.getByText("Đã dọn")).toBeVisible();
  expect(existsSync(run.workspace.path)).toBe(false);
});

test("uncommitted repo files must be acknowledged before a worktree run starts", async ({ page }) => {
  const repo = createGitRepo("dirty");
  writeFileSync(path.join(repo, "src", "app.txt"), "uncommitted\n");
  await openRepo(page, repo);
  await page.goto("/#/tasks/WT-1");
  await page.getByLabel("Chạy trong Git worktree riêng").check();
  const alert = page.getByRole("alert").filter({ hasText: "file chưa commit" });
  await expect(alert).toBeVisible();
  await expect(alert.getByText("src/app.txt")).toBeVisible();
  const start = page.getByRole("button", { name: "Bắt đầu quy trình" });
  await expect(start).toBeDisabled();
  // The API refuses as well, and lists the files.
  const refused = await page.request.post("/api/tasks/WT-1/run", { data: { isolation: "worktree" } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).files).toEqual(["src/app.txt"]);

  await alert.getByLabel("Chạy trên HEAD, không mang các thay đổi chưa commit").check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByText("Lúc tạo, ba đã xác nhận bỏ qua 1 file chưa commit của repo.")).toBeVisible();
  // Nothing was stashed or reset in the repo.
  expect(readFileSync(path.join(repo, "src", "app.txt"), "utf8")).toBe("uncommitted\n");
  await stopRun(page);
});

test("the worktree option is unavailable outside a Git repo", async ({ page }) => {
  // Outside e2e/.tmp, which lies inside this repo's own Git tree.
  const repo = path.join(mkdtempSync(path.join(os.tmpdir(), "taskpilot-e2e-")), "not git");
  try {
    mkdirSync(path.join(repo, ".claude", "tasks", "WT-1", "spec"), { recursive: true });
    writeFileSync(path.join(repo, ".claude", "tasks", "WT-1", "spec", "README.md"), "# Not git\n");
    await openRepo(page, repo);
    await page.goto("/#/tasks/WT-1");
    await expect(page.getByLabel("Chạy trong Git worktree riêng")).toBeDisabled();
    await expect(page.getByText(/không phải Git repo/)).toBeVisible();
  } finally {
    rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test("integration asks before committing, keeps the worktree when it fails, and merges on request", async ({ page }) => {
  const repo = createGitRepo("integrate");
  await openRepo(page, repo);
  expect((await page.request.post("/api/tasks/WT-1/run", { data: { isolation: "worktree" } })).ok()).toBe(true);
  const run = await runOf(page);
  await stopRun(page);
  writeFileSync(path.join(run.workspace.cwd, "src", "app.txt"), "line 1\nfrom the run\n");
  writeFileSync(path.join(repo, "local.txt"), "user work\n");

  await page.goto("/#/tasks/WT-1");
  const panel = page.getByRole("region", { name: "Worktree của run" });
  await panel.getByRole("button", { name: "Tích hợp", exact: true }).click();
  // The worktree's own uncommitted file: listed, and TaskPilot commits only after the user confirms.
  await expect(panel.getByRole("listitem").filter({ hasText: /^src\/app\.txt$/ })).toBeVisible();
  await panel.getByRole("button", { name: "Commit các thay đổi rồi tích hợp" }).click();
  // The repo is dirty: refused, the repo and the worktree stay as they were.
  await expect(panel.getByRole("alert").filter({ hasText: "Repo gốc có 1 file chưa commit" })).toBeVisible();
  expect(readFileSync(path.join(repo, "src", "app.txt"), "utf8")).toBe("line 1\n");
  expect(existsSync(run.workspace.path)).toBe(true);

  gitIn(repo, "add", "local.txt");
  gitIn(repo, "commit", "-q", "-m", "user work");
  // Refused before TaskPilot committed anything: the worktree file is still uncommitted, so it asks again.
  await panel.getByRole("button", { name: "Tích hợp", exact: true }).click();
  await panel.getByRole("button", { name: "Commit các thay đổi rồi tích hợp" }).click();
  await expect(panel.getByText("Đã tích hợp")).toBeVisible();
  expect(readFileSync(path.join(repo, "src", "app.txt"), "utf8")).toBe("line 1\nfrom the run\n");
  expect(gitIn(repo, "status", "--porcelain")).toBe("");
});
