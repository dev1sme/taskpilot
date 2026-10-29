import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../../../src/core/state.js";
import { WorktreeConflict, WorktreeManager } from "../../../src/modules/workspace/index.js";
import { gitSync, makeGitRepo } from "../../helpers/git-repo.js";

let dir: string;
let repo: string;
let state: StateStore;
let manager: WorktreeManager;

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  // Spaces in every path: TaskPilot passes paths to git as arguments, never through a shell.
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "tpl025 worktree ")));
  repo = await makeGitRepo(path.join(dir, "my repo"));
  state = new StateStore(path.join(dir, "state dir"));
  manager = new WorktreeManager(state);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

it("refuses a folder that is not a Git repo or has no commit", async () => {
  const plain = path.join(dir, "plain");
  await mkdir(plain);
  expect(await manager.check(plain)).toMatchObject({ git: false, dirty: [] });
  await expect(manager.create(plain, "DEMO-1", "run-plain-0001")).rejects.toMatchObject({ status: 400 });

  const empty = path.join(dir, "empty");
  await mkdir(empty);
  gitSync(empty, "init", "-q");
  const check = await manager.check(empty);
  expect(check.git).toBe(true);
  expect(check.problem).toBeTruthy();
  await expect(manager.create(empty, "DEMO-1", "run-empty-0001")).rejects.toMatchObject({ status: 400 });
  expect((await state.load()).workspaces ?? []).toHaveLength(0);
});

it("stops on uncommitted repo files unless the user accepts starting from HEAD without them", async () => {
  await writeFile(path.join(repo, "src", "app.txt"), "uncommitted\n");
  await writeFile(path.join(repo, "new file.txt"), "untracked\n");
  // Ignored files (the task folder, .env) are not uncommitted changes.
  await writeFile(path.join(repo, ".env"), "SECRET=1\n");
  const check = await manager.check(repo);
  expect(check.dirty.sort()).toEqual(["new file.txt", "src/app.txt"]);

  const refused = await manager.create(repo, "DEMO-1", "aaaaaaaa-1111").catch((e: unknown) => e);
  expect(refused).toBeInstanceOf(WorktreeConflict);
  expect((refused as WorktreeConflict).files.sort()).toEqual(["new file.txt", "src/app.txt"]);

  const ws = await manager.create(repo, "DEMO-1", "aaaaaaaa-1111", { acceptDirty: true });
  expect(ws.dirtyBaseAccepted?.sort()).toEqual(["new file.txt", "src/app.txt"]);
  // The worktree starts at HEAD: neither the uncommitted edit nor ignored files come along.
  expect(await readFile(path.join(ws.cwd, "src", "app.txt"), "utf8")).toBe("line 1\nline 2\n");
  expect(await exists(path.join(ws.cwd, ".env"))).toBe(false);
  expect(await exists(path.join(ws.cwd, ".claude", "tasks"))).toBe(false);
  // Nothing in the repo was stashed, reset or committed.
  expect(await readFile(path.join(repo, "src", "app.txt"), "utf8")).toBe("uncommitted\n");
  expect(gitSync(repo, "rev-list", "--count", "HEAD").trim()).toBe("1");
});

it("gives two runs separate worktrees that do not see each other's changes, outside the repo", async () => {
  const a = await manager.create(repo, "DEMO-1", "aaaaaaaa-run1");
  const b = await manager.create(repo, "DEMO-2", "bbbbbbbb-run2");
  expect(a.path).not.toBe(b.path);
  expect(a.path.startsWith(path.join(state.dir, "worktrees"))).toBe(true);
  expect(a.branch).toBe("taskpilot/DEMO-1-aaaaaaaa");
  expect(a.baseBranch).toBe("main");
  await writeFile(path.join(a.cwd, "src", "app.txt"), "from run A\n");
  await writeFile(path.join(b.cwd, "src", "app.txt"), "from run B\n");
  expect(await readFile(path.join(a.cwd, "src", "app.txt"), "utf8")).toBe("from run A\n");
  expect(await readFile(path.join(b.cwd, "src", "app.txt"), "utf8")).toBe("from run B\n");
  expect(await readFile(path.join(repo, "src", "app.txt"), "utf8")).toBe("line 1\nline 2\n");
  expect(gitSync(repo, "status", "--porcelain")).toBe("");

  const view = await manager.view(a, false);
  expect(view.changes).toEqual(["src/app.txt"]);
  expect(view.commits).toBe(0);
  expect(view.diffStat).toContain("src/app.txt");
  expect((await manager.diff(a)).diff).toContain("+from run A");
  expect((await manager.list(repo, "DEMO-1")).map((w) => w.runId)).toEqual(["aaaaaaaa-run1"]);
});

it("runs sessions in the same subfolder of the worktree when the repo is below the Git top level", async () => {
  const sub = path.join(repo, "packages", "app");
  await mkdir(sub, { recursive: true });
  await writeFile(path.join(sub, "index.txt"), "x\n");
  gitSync(repo, "add", "-A");
  gitSync(repo, "commit", "-q", "-m", "sub");
  const ws = await manager.create(sub, "DEMO-1", "cccccccc-sub");
  expect(ws.cwd).toBe(path.join(ws.path, "packages", "app"));
  expect(await readFile(path.join(ws.cwd, "index.txt"), "utf8")).toBe("x\n");
});

it("integrates on request: asks before committing worktree changes, refuses a dirty repo, merges --no-ff", async () => {
  const ws = await manager.create(repo, "DEMO-1", "dddddddd-int");
  await writeFile(path.join(ws.cwd, "src", "app.txt"), "line 1\nline 2\nline 3\n");

  const uncommitted = await manager.integrate(ws).catch((e: unknown) => e);
  expect(uncommitted).toBeInstanceOf(WorktreeConflict);
  expect((uncommitted as WorktreeConflict).files).toEqual(["src/app.txt"]);

  await writeFile(path.join(repo, "local.txt"), "user work\n");
  const dirtyRepo = await manager.integrate(ws, { commit: true }).catch((e: unknown) => e);
  expect(dirtyRepo).toBeInstanceOf(WorktreeConflict);
  expect((dirtyRepo as WorktreeConflict).files).toEqual(["local.txt"]);
  await rm(path.join(repo, "local.txt"));

  const done = await manager.integrate(ws, { commit: true });
  expect(done.integration.status).toBe("integrated");
  expect(await readFile(path.join(repo, "src", "app.txt"), "utf8")).toBe("line 1\nline 2\nline 3\n");
  // A merge commit with two parents: the run's history stays visible in the repo.
  expect(gitSync(repo, "rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ")).toHaveLength(3);
  expect(gitSync(repo, "log", "-1", "--format=%s", `${ws.branch}`).trim()).toBe("taskpilot: DEMO-1 run dddddddd");
  await expect(manager.integrate(done)).rejects.toMatchObject({ status: 409 });
});

it("aborts a conflicting merge: the repo is left as it was, the worktree and branch stay, the failure is recorded", async () => {
  const a = await manager.create(repo, "DEMO-1", "eeeeeeee-one");
  const b = await manager.create(repo, "DEMO-2", "ffffffff-two");
  await writeFile(path.join(a.cwd, "src", "app.txt"), "A wins\n");
  await writeFile(path.join(b.cwd, "src", "app.txt"), "B wins\n");
  await manager.integrate(a, { commit: true });
  const head = gitSync(repo, "rev-parse", "HEAD").trim();

  await expect(manager.integrate(b, { commit: true })).rejects.toMatchObject({ status: 409 });
  expect(gitSync(repo, "rev-parse", "HEAD").trim()).toBe(head);
  expect(gitSync(repo, "status", "--porcelain")).toBe("");
  expect(await exists(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  expect(await readFile(path.join(b.cwd, "src", "app.txt"), "utf8")).toBe("B wins\n");
  const failed = (await manager.get(b.runId))!;
  expect(failed.integration.status).toBe("failed");
  expect(failed.integration.message).toBeTruthy();
});

it("removes only on request: uncommitted work needs force, an unmerged branch is kept, the record stays", async () => {
  const ws = await manager.create(repo, "DEMO-1", "99999999-rm");
  await writeFile(path.join(ws.cwd, "committed.txt"), "leader commit\n");
  gitSync(ws.cwd, "add", "-A");
  gitSync(ws.cwd, "commit", "-q", "-m", "run work");
  await writeFile(path.join(ws.cwd, "src", "app.txt"), "work in progress\n");
  await expect(manager.remove(ws)).rejects.toBeInstanceOf(WorktreeConflict);
  expect(await exists(ws.path)).toBe(true);

  const removed = await manager.remove(ws, { force: true });
  expect(await exists(ws.path)).toBe(false);
  expect(removed.removedAt).toBeTypeOf("number");
  expect(removed.branchKept).toBe(true);
  expect(gitSync(repo, "branch", "--list", ws.branch).trim()).toContain(ws.branch);
  expect((await manager.list(repo, "DEMO-1"))[0].removedAt).toBe(removed.removedAt);
  expect((await manager.view(removed, false)).changes).toBeNull();
});

it("deletes the branch of an integrated run on removal", async () => {
  const ws = await manager.create(repo, "DEMO-1", "88888888-merged");
  await writeFile(path.join(ws.cwd, "src", "app.txt"), "merged\n");
  const integrated = await manager.integrate(ws, { commit: true });
  const removed = await manager.remove(integrated);
  expect(removed.branchKept).toBe(false);
  expect(gitSync(repo, "branch", "--list", ws.branch).trim()).toBe("");
});

it("reconcile only marks a missing worktree; it never deletes or recreates", async () => {
  const ws = await manager.create(repo, "DEMO-1", "77777777-gone");
  await rm(ws.path, { recursive: true, force: true });
  await manager.reconcile();
  expect((await manager.get(ws.runId))!.missing).toBe(true);
  expect(await exists(ws.path)).toBe(false);
  // Records survive a server restart (a new store reading the same file).
  const reread = new WorktreeManager(new StateStore(state.dir));
  expect((await reread.get(ws.runId))!.missing).toBe(true);
});

it("discards an unused worktree and its branch when the run could not start", async () => {
  const ws = await manager.create(repo, "DEMO-1", "66666666-unused");
  await manager.discardUnused(ws);
  expect(await exists(ws.path)).toBe(false);
  expect(gitSync(repo, "branch", "--list", ws.branch).trim()).toBe("");
  expect(await manager.get(ws.runId)).toBeUndefined();
});
