import { createHash } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../core/errors.js";
import { t } from "../../core/i18n.js";
import { SerialQueue } from "../../core/serial.js";
import type { StateStore } from "../../core/state.js";
import { changedFiles, git, gitMaybe } from "./git.js";
import type { RunWorkspace, WorkspaceDiff, WorkspaceView, WorktreeCheck } from "./types.js";

const MAX_DIFF_BYTES = 512 * 1024;
const LISTED_FILES = 10;

/** "a, b, c (+4)": enough of a file list for an error message. */
function fileList(files: string[]): string {
  const shown = files.slice(0, LISTED_FILES).join(", ");
  return files.length > LISTED_FILES ? `${shown} (+${files.length - LISTED_FILES})` : shown;
}

/** A branch-name-safe form of the task key: `..`, `.lock` and other ref-format traps cannot occur. */
function refSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

async function exists(dir: string): Promise<boolean> {
  return stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/**
 * Thrown with the files involved, so the UI can list them and ask before going on. `reason`: whose
 * uncommitted files they are — the repo's at start (`base`) or integrate (`repo`), or the worktree's.
 */
export class WorktreeConflict extends HttpError {
  constructor(
    message: string,
    readonly files: string[],
    readonly reason: "base" | "repo" | "worktree",
  ) {
    super(409, message);
  }
}

/**
 * Creates, inspects, integrates and removes the Git worktree a run executes in. Never stashes,
 * resets or commits in the user's repo on its own: every such step is an explicit user action.
 * Records live in state.json (`workspaces`), keyed by run id.
 */
export class WorktreeManager {
  private readonly queue = new SerialQueue();
  readonly root: string;

  constructor(
    private readonly state: StateStore,
    root = path.join(state.dir, "worktrees"),
  ) {
    this.root = root;
  }

  /** Whether `repo` can get a worktree, and what uncommitted files it would leave behind. */
  async check(repo: string): Promise<WorktreeCheck> {
    const top = (await gitMaybe(repo, ["rev-parse", "--show-toplevel"]))?.trim();
    if (!top) return { git: false, problem: t("worktree.notGit"), dirty: [] };
    // A folder that the enclosing repo ignores would not exist in a worktree of that repo.
    const inside = path.relative(await realpath(top), repo);
    if (inside && (await gitMaybe(top, ["check-ignore", "-q", "--", inside])) !== null) return { git: false, problem: t("worktree.ignored"), dirty: [] };
    const head = (await gitMaybe(repo, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]))?.trim();
    if (!head) return { git: true, problem: t("worktree.noCommit"), dirty: [] };
    const branch = (await gitMaybe(repo, ["symbolic-ref", "-q", "--short", "HEAD"]))?.trim();
    return { git: true, head, ...(branch ? { branch } : {}), dirty: await changedFiles(repo) };
  }

  /**
   * A new worktree on a new branch at the repo's HEAD. Uncommitted repo changes are not carried over:
   * without `acceptDirty` they stop the run, listed, so the user decides what to do with them.
   */
  create(repo: string, taskKey: string, runId: string, opts: { acceptDirty?: boolean } = {}): Promise<RunWorkspace> {
    return this.queue.run(async () => {
      const check = await this.check(repo);
      if (check.problem || !check.head) throw new HttpError(400, check.problem ?? t("worktree.notGit"));
      if (check.dirty.length && !opts.acceptDirty) {
        throw new WorktreeConflict(t("worktree.dirtyBase", { count: check.dirty.length, files: fileList(check.dirty) }), check.dirty, "base");
      }
      const top = await realpath((await git(repo, ["rev-parse", "--show-toplevel"])).trim());
      const short = runId.slice(0, 8);
      const dir = path.join(this.root, createHash("sha1").update(repo).digest("hex").slice(0, 12), `${refSafe(taskKey)}-${short}`);
      const branch = `taskpilot/${refSafe(taskKey)}-${short}`;
      await mkdir(path.dirname(dir), { recursive: true });
      try {
        await git(top, ["worktree", "add", "-b", branch, dir, check.head]);
      } catch (error) {
        throw new HttpError(500, t("worktree.createFailed", { error: (error as Error).message }));
      }
      const workspace: RunWorkspace = {
        runId,
        repo,
        taskKey,
        kind: "worktree",
        path: dir,
        // The repo may be a folder inside the Git top level: sessions run in the same folder of the worktree.
        cwd: path.join(dir, path.relative(top, repo)),
        branch,
        baseRev: check.head,
        ...(check.branch ? { baseBranch: check.branch } : {}),
        createdAt: Date.now(),
        ...(check.dirty.length ? { dirtyBaseAccepted: check.dirty } : {}),
        integration: { status: "pending" },
      };
      await this.save(workspace);
      return workspace;
    });
  }

  /** Undoes a create whose run never started (no session ran in it): the worktree is still at its base. */
  discardUnused(workspace: RunWorkspace): Promise<void> {
    return this.queue.run(async () => {
      const top = await this.topOf(workspace);
      await git(top, ["worktree", "remove", "--force", workspace.path]).catch(() => undefined);
      await git(top, ["branch", "-D", workspace.branch]).catch(() => undefined);
      await this.state.update((s) => {
        s.workspaces = (s.workspaces ?? []).filter((w) => w.runId !== workspace.runId);
      });
    });
  }

  async get(runId: string): Promise<RunWorkspace | undefined> {
    const found = (await this.state.load()).workspaces?.find((w) => w.runId === runId);
    return found ? structuredClone(found) : undefined;
  }

  async require(repo: string, taskKey: string, runId: string): Promise<RunWorkspace> {
    const found = await this.get(runId);
    if (!found || found.repo !== repo || found.taskKey !== taskKey) throw new HttpError(404, t("worktree.notFound"));
    return found;
  }

  /** The task's worktrees, newest first, removed ones included (they keep the integration record). */
  async list(repo: string, taskKey: string): Promise<RunWorkspace[]> {
    const all = (await this.state.load()).workspaces ?? [];
    return structuredClone(all.filter((w) => w.repo === repo && w.taskKey === taskKey).sort((a, b) => b.createdAt - a.createdAt));
  }

  async view(workspace: RunWorkspace, active: boolean): Promise<WorkspaceView> {
    const readable = !workspace.removedAt && (await exists(workspace.path));
    if (!readable) return { ...workspace, changes: null, commits: null, diffStat: null, active };
    const [changes, commits, diffStat] = await Promise.all([
      changedFiles(workspace.path).catch(() => null),
      gitMaybe(workspace.path, ["rev-list", "--count", `${workspace.baseRev}..HEAD`]).then((out) => (out === null ? null : Number(out.trim()))),
      gitMaybe(workspace.path, ["diff", "--stat", workspace.baseRev]).then((out) => (out === null ? null : out.trimEnd())),
    ]);
    return { ...workspace, changes, commits, diffStat, active };
  }

  /** Everything the run changed since its base, committed or not; untracked files are listed, not shown. */
  async diff(workspace: RunWorkspace): Promise<WorkspaceDiff> {
    if (workspace.removedAt || !(await exists(workspace.path))) throw new HttpError(409, t("worktree.missing", { path: workspace.path }));
    const tracked = await git(workspace.path, ["diff", "--no-color", "--no-ext-diff", workspace.baseRev]);
    const untracked = (await git(workspace.path, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    const text = `${tracked}${untracked.length ? `\n# Untracked files\n${untracked.map((f) => `# ${f}`).join("\n")}\n` : ""}`;
    const truncated = Buffer.byteLength(text) > MAX_DIFF_BYTES;
    return { diff: truncated ? Buffer.from(text).subarray(0, MAX_DIFF_BYTES).toString() : text, truncated };
  }

  /**
   * Merges the run's branch into the branch checked out in the repo (`--no-ff`). Uncommitted
   * worktree changes need `commit` (TaskPilot then commits them on the run's branch); a dirty repo
   * is refused. A failed merge is aborted: the repo is left as it was, the worktree and branch stay.
   */
  integrate(workspace: RunWorkspace, opts: { commit?: boolean } = {}): Promise<RunWorkspace> {
    return this.queue.run(async () => {
      const current = (await this.get(workspace.runId)) ?? workspace;
      if (current.removedAt || !(await exists(current.path))) throw new HttpError(409, t("worktree.missing", { path: current.path }));
      if (current.integration.status === "integrated") throw new HttpError(409, t("worktree.alreadyIntegrated"));
      const pending = await changedFiles(current.path);
      if (pending.length && !opts.commit) throw new WorktreeConflict(t("worktree.dirty", { count: pending.length, files: fileList(pending) }), pending, "worktree");
      const top = await this.topOf(current);
      const repoDirty = await changedFiles(top);
      if (repoDirty.length) throw new WorktreeConflict(t("worktree.repoDirty", { count: repoDirty.length, files: fileList(repoDirty) }), repoDirty, "repo");
      if (pending.length) {
        try {
          await git(current.path, ["add", "-A"]);
          await git(current.path, ["commit", "--no-verify", "-m", `taskpilot: ${current.taskKey} run ${current.runId.slice(0, 8)}`]);
        } catch (error) {
          throw new HttpError(500, t("worktree.commitFailed", { error: (error as Error).message }));
        }
      }
      try {
        await git(top, ["merge", "--no-ff", "--no-edit", current.branch]);
      } catch (error) {
        // Leave the repo exactly as before the merge; the conflict is resolved by the user, not here.
        if ((await gitMaybe(top, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])) !== null) await git(top, ["merge", "--abort"]).catch(() => undefined);
        const message = t("worktree.mergeFailed", { error: (error as Error).message });
        current.integration = { status: "failed", at: Date.now(), message };
        await this.save(current);
        throw new HttpError(409, message);
      }
      const mergeRev = (await git(top, ["rev-parse", "HEAD"])).trim();
      current.integration = { status: "integrated", at: Date.now(), mergeRev };
      await this.save(current);
      return current;
    });
  }

  /**
   * Removes the worktree directory; the record stays. Uncommitted changes need `force`. The branch
   * is deleted only once the repo has merged it, so commits are never lost by a cleanup.
   * The caller proves first that no session of the run can still write in it.
   */
  remove(workspace: RunWorkspace, opts: { force?: boolean } = {}): Promise<RunWorkspace> {
    return this.queue.run(async () => {
      const current = (await this.get(workspace.runId)) ?? workspace;
      if (current.removedAt) return current;
      const top = await this.topOf(current);
      if (await exists(current.path)) {
        const pending = await changedFiles(current.path).catch(() => []);
        if (pending.length && !opts.force) throw new WorktreeConflict(t("worktree.removeDirty", { count: pending.length, files: fileList(pending) }), pending, "worktree");
        try {
          await git(top, ["worktree", "remove", ...(pending.length ? ["--force"] : []), current.path]);
        } catch (error) {
          throw new HttpError(500, t("worktree.removeFailed", { error: (error as Error).message }));
        }
      } else {
        await git(top, ["worktree", "prune"]).catch(() => undefined);
      }
      const merged = (await gitMaybe(top, ["merge-base", "--is-ancestor", current.branch, "HEAD"])) !== null;
      if (merged) await git(top, ["branch", "-d", current.branch]).catch(() => undefined);
      current.removedAt = Date.now();
      current.branchKept = !merged;
      delete current.missing;
      await this.save(current);
      return current;
    });
  }

  /** At startup: marks records whose directory is gone. Never removes or recreates anything. */
  reconcile(): Promise<void> {
    return this.queue.run(async () => {
      const all = (await this.state.load()).workspaces ?? [];
      const missing = new Map<string, boolean>();
      for (const w of all) if (!w.removedAt) missing.set(w.runId, !(await exists(w.path)));
      if (![...missing].some(([id, gone]) => !!all.find((w) => w.runId === id)?.missing !== gone)) return;
      await this.state.update((s) => {
        for (const w of s.workspaces ?? []) {
          const gone = missing.get(w.runId);
          if (gone === undefined) continue;
          if (gone) w.missing = true;
          else delete w.missing;
        }
      });
    });
  }

  /** The repo's Git top level, where merges and worktree commands run. */
  private async topOf(workspace: RunWorkspace): Promise<string> {
    return (await git(workspace.repo, ["rev-parse", "--show-toplevel"])).trim();
  }

  private async save(workspace: RunWorkspace): Promise<void> {
    await this.state.update((s) => {
      const all = (s.workspaces ??= []);
      const index = all.findIndex((w) => w.runId === workspace.runId);
      if (index >= 0) all[index] = structuredClone(workspace);
      else all.push(structuredClone(workspace));
    });
  }
}
