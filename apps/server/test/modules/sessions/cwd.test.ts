import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/manager.js";
import { claudeLauncher } from "../../../src/providers/claude/cli-launcher.js";
import { codexLauncher } from "../../../src/providers/codex/cli-launcher.js";
import { copilotLauncher } from "../../../src/providers/copilot/cli-launcher.js";

// Writes where it runs and the options TaskPilot launched it with, then stays alive like a TUI.
const SCRIPT = `require("fs").appendFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), opts: JSON.parse(process.argv[2]), env: process.env.REPO_ENV ?? null }) + "\\n"); setInterval(() => {}, 1000);`;

let dir: string;
let repo: string;
let worktree: string;
let out: string;
let manager: SessionManager;
const envRequests: string[] = [];

const lines = async () =>
  (await readFile(out, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { cwd: string; opts: { repo?: string; extraDirs?: string[]; resume: boolean }; env: string | null });

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "tpl025 cwd ")));
  repo = path.join(dir, "repo");
  worktree = path.join(dir, "worktrees", "DEMO-1 run");
  out = path.join(dir, "spawns.jsonl");
  await mkdir(repo, { recursive: true });
  await mkdir(worktree, { recursive: true });
  envRequests.length = 0;
  manager = new SessionManager(new StateStore(path.join(dir, "state")), {
    launcher: (_id, opts) => ({ file: process.execPath, args: ["-e", SCRIPT, out, JSON.stringify({ repo: opts.repo, extraDirs: opts.extraDirs, resume: opts.resume })] }),
    extraEnv: async (r) => {
      envRequests.push(r);
      return { REPO_ENV: `env of ${r}` };
    },
  });
});

afterEach(async () => {
  manager.closeAll();
  await rm(dir, { recursive: true, force: true });
});

it("spawns and resumes a run's session in its worktree, with the task folder allowed and the repo's env", async () => {
  const taskDir = path.join(repo, ".claude", "tasks", "DEMO-1");
  const session = await manager.create(repo, "DEMO-1", { cwd: worktree, extraDirs: [taskDir], runId: "run-1" });
  expect(session).toMatchObject({ repo, cwd: worktree, extraDirs: [taskDir], runId: "run-1" });
  await expect.poll(async () => (await lines()).length).toBe(1);
  expect((await lines())[0]).toEqual({ cwd: worktree, opts: { repo: worktree, extraDirs: [taskDir], resume: false }, env: `env of ${repo}` });

  // The barrier refuses while the session runs in the worktree.
  await expect(manager.quiesce(worktree)).rejects.toMatchObject({ status: 409 });
  await manager.stopAndWait(session.id, { timeoutMs: 3000 });
  await manager.quiesce(worktree, { timeoutMs: 3000 });

  // A resume needs the same folder: Claude and Codex keep transcripts per working directory.
  await manager.resume(session.id);
  await expect.poll(async () => (await lines()).length).toBe(2);
  expect((await lines())[1]).toEqual({ cwd: worktree, opts: { repo: worktree, extraDirs: [taskDir], resume: true }, env: `env of ${repo}` });
  expect(envRequests.every((r) => r === repo)).toBe(true);
  await manager.stopAndWait(session.id, { timeoutMs: 3000 });
});

it("keeps sessions without a worktree in the repo", async () => {
  const session = await manager.create(repo, "DEMO-1", {});
  expect(session.cwd).toBeUndefined();
  await expect.poll(async () => (await lines()).length).toBe(1);
  expect((await lines())[0].cwd).toBe(repo);
  await manager.stopAndWait(session.id, { timeoutMs: 3000 });
});

it("checks a Codex subagent where the session will run, not only in the repo", async () => {
  // Git-ignored config (.codex/ here) exists in the repo but not in a fresh worktree.
  await mkdir(path.join(repo, ".codex", "agents"), { recursive: true });
  await writeFile(path.join(repo, ".codex", "agents", "helper.toml"), 'developer_instructions = "Help."\n');
  const inWorktree = await manager.preflight(repo, { agent: "codex", subagent: "helper" }, { cwd: worktree });
  expect(inWorktree.status).toBe("blocked");
  expect(inWorktree.errors.map((e) => e.code)).toContain("unsupported_subagent");
  const inRepo = await manager.preflight(repo, { agent: "codex", subagent: "helper" });
  expect(inRepo.errors.map((e) => e.code)).not.toContain("unsupported_subagent");
});

it("passes extra directories as --add-dir to all three CLIs, on resume too", () => {
  const extraDirs = ["/repo with space/.claude/tasks/DEMO-1"];
  expect(claudeLauncher("s1", { resume: true, extraDirs }).args).toEqual(expect.arrayContaining(["--resume", "s1", "--add-dir", extraDirs[0]]));
  const codex = codexLauncher("s2", { resume: true, nativeId: "thread", extraDirs, repo: "/tmp" }).args;
  expect(codex.slice(0, 2)).toEqual(["resume", "thread"]);
  expect(codex.slice(-2)).toEqual(["--add-dir", extraDirs[0]]);
  expect(copilotLauncher("s3", { resume: false, extraDirs }).args).toEqual(expect.arrayContaining(["--add-dir", extraDirs[0]]));
  expect(claudeLauncher("s4", { resume: false }).args).not.toContain("--add-dir");
});

it("refuses to retire a session for a replacement in another working tree", async () => {
  const source = await manager.create(repo, "DEMO-1", { cwd: worktree, runId: "run-1" });
  await manager.stopAndWait(source.id, { timeoutMs: 3000 });
  await manager.reserve(source.id, "op-1");
  const elsewhere = await manager.create(repo, "DEMO-1", { operationId: "op-1" });
  await expect(manager.retire(source.id, "op-1", elsewhere.id)).rejects.toThrow("different working tree");
  expect((await manager.get(source.id)).retired).toBeUndefined();
  await manager.stopAndWait(elsewhere.id, { timeoutMs: 3000 });
});
