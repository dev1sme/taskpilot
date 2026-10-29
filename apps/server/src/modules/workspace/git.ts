import { execFile } from "node:child_process";

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

/**
 * Runs git with an argument array (no shell, so paths with spaces or quotes stay one argument).
 * Prompts and pagers are off: TaskPilot never waits for a terminal.
 */
export function git(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C" },
        timeout: opts.timeoutMs ?? TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = typeof error.code === "number" ? error.code : null;
          const detail = String(stderr).trim() || error.message;
          reject(new GitError(`git ${args[0]} failed: ${detail.slice(0, 2000)}`, code, String(stderr)));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

/** Like `git`, but a non-zero exit is `null` instead of an error (for questions such as rev-parse --verify). */
export async function gitMaybe(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Paths of `git status --porcelain -z`, untracked included and ignored excluded; a rename lists its new path. */
export async function changedFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const parts = out.split("\0");
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    // A rename or copy is followed by its original path.
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return files;
}
