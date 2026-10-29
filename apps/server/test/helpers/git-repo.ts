import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Runs git in `cwd` with a fixed identity, so commits work without the user's Git config. */
export function gitSync(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=TaskPilot Test", "-c", "user.email=test@taskpilot.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
  });
}

/**
 * A Git repo at `dir` with one commit: `src/app.txt`, and a `.gitignore` that ignores the task
 * folder as this repo does. Identity is set in the repo's own config for commits TaskPilot makes.
 */
export async function makeGitRepo(dir: string, taskKey = "DEMO-1"): Promise<string> {
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, ".claude", "tasks", taskKey, "spec"), { recursive: true });
  await writeFile(path.join(dir, ".gitignore"), ".claude/tasks\n.env\n");
  await writeFile(path.join(dir, "src", "app.txt"), "line 1\nline 2\n");
  await writeFile(path.join(dir, ".claude", "tasks", taskKey, "spec", "context.md"), "# Demo\n");
  gitSync(dir, "init", "-q", "-b", "main");
  gitSync(dir, "config", "user.name", "TaskPilot Test");
  gitSync(dir, "config", "user.email", "test@taskpilot.invalid");
  gitSync(dir, "config", "commit.gpgsign", "false");
  gitSync(dir, "add", "-A");
  gitSync(dir, "commit", "-q", "-m", "base");
  return dir;
}
