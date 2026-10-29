/** Whether the run's branch has been merged into the repo; independent of the run's own phase. */
export type IntegrationStatus = "pending" | "integrated" | "failed";

/**
 * The Git worktree one run executes in. Kept in state.json by run id, apart from the run itself, so a
 * restart that replaces the task's run never loses an older worktree that still holds changes.
 */
export interface RunWorkspace {
  runId: string;
  /** The repo TaskPilot works on (its realpath); task documents, env and config stay keyed by it. */
  repo: string;
  taskKey: string;
  kind: "worktree";
  /** Top of the worktree (`git worktree add` target). */
  path: string;
  /** Where sessions run: `path`, or the same subdirectory of it when `repo` is below the Git top level. */
  cwd: string;
  branch: string;
  /** The commit the worktree started from (the repo's HEAD at creation). */
  baseRev: string;
  /** The repo's branch at creation; absent on a detached HEAD. */
  baseBranch?: string;
  createdAt: number;
  /** Uncommitted repo files the user accepted to leave out of the worktree. */
  dirtyBaseAccepted?: string[];
  integration: { status: IntegrationStatus; at?: number; mergeRev?: string; message?: string };
  removedAt?: number;
  /** The branch was kept on removal because the repo has not merged it. */
  branchKept?: boolean;
  /** The worktree directory was not found at the last check. */
  missing?: boolean;
}

/** What a run in a worktree may start from: GET /api/tasks/:key/run/worktree-check. */
export interface WorktreeCheck {
  git: boolean;
  /** Why a worktree cannot be made here (not a Git repo, no commit yet); absent = it can. */
  problem?: string;
  head?: string;
  branch?: string;
  /** Uncommitted files (porcelain paths, ignored files excluded); they are not carried into the worktree. */
  dirty: string[];
}

/** A worktree as the UI shows it: the record plus what Git says about it now. */
export interface WorkspaceView extends RunWorkspace {
  /** Uncommitted files in the worktree; null when it could not be read (removed, missing). */
  changes: string[] | null;
  /** Commits on the run's branch since `baseRev`; null when unreadable. */
  commits: number | null;
  /** `git diff --stat` against `baseRev`, uncommitted tracked changes included. */
  diffStat: string | null;
  /** Whether a session of this run may still be writing in the worktree. */
  active: boolean;
}

export interface WorkspaceDiff {
  diff: string;
  truncated: boolean;
}
