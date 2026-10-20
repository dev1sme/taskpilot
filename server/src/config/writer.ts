import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { HttpError } from "../core/errors.js";
import type { BackupEntry, BackupStore } from "./backups.js";
import { claudeHome } from "./fs.js";
import { isAllowedPath, type FileTarget } from "./targets.js";
import { t } from "../core/i18n.js";

/**
 * A directory between the repo (or ~/.claude) and the file that is a symlink, e.g. a skill folder
 * linked from elsewhere: writing through it would land outside the allowed paths. The repo and
 * ~/.claude themselves may be symlinks.
 */
async function symlinkedDir(abs: string, repo: string): Promise<string | null> {
  const file = path.resolve(abs);
  const root = [path.resolve(repo), path.resolve(claudeHome())].find((r) => file.startsWith(r + path.sep));
  if (!root) return null;
  for (let dir = path.dirname(file); dir !== root && dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    try {
      if ((await lstat(dir)).isSymbolicLink()) return path.relative(root, dir);
    } catch {
      // Not created yet: nothing to follow.
    }
  }
  return null;
}

/** Version token of a file's content; "absent" when the file does not exist. */
export function hashOf(content: string | null): string {
  return content === null ? "absent" : createHash("sha256").update(content).digest("hex");
}

export async function readCurrent(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Unified diff shown to the user before a save. */
export function diffText(display: string, before: string | null, after: string | null): string {
  return createTwoFilesPatch(display, display, before ?? "", after ?? "", t("diff.before"), t("diff.after"), { context: 3 });
}

/**
 * Writes `next` (or deletes the file when null) only if the file still has the content the user
 * started from (`baseHash`), after backing up what is there. The write is atomic (temp file +
 * rename) and keeps the file's mode. Symlinks are refused so a write cannot land elsewhere.
 */
export async function writeWithBackup(opts: {
  repo: string;
  target: FileTarget;
  next: string | null;
  baseHash: string;
  reason: string;
  backups: BackupStore;
}): Promise<{ hash: string; backup: BackupEntry }> {
  const { target } = opts;
  if (!isAllowedPath(target.abs, opts.repo)) throw new HttpError(403, t("errors.writeForbidden", { file: target.display }));
  const linked = await symlinkedDir(target.abs, opts.repo);
  if (linked) throw new HttpError(409, t("errors.symlinkDir", { file: target.display, link: linked }));

  let mode: number | undefined;
  try {
    const st = await lstat(target.abs);
    if (st.isSymbolicLink()) throw new HttpError(409, t("errors.symlink", { file: target.display }));
    mode = st.mode & 0o777;
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }

  const current = await readCurrent(target.abs);
  if (hashOf(current) !== opts.baseHash) {
    throw new HttpError(409, t("errors.changedOutside", { file: target.display }));
  }

  const backup = await opts.backups.save(target, current, opts.reason);
  if (opts.next === null) {
    await rm(target.abs, { force: true });
    return { hash: hashOf(null), backup };
  }

  await mkdir(path.dirname(target.abs), { recursive: true });
  const tmp = `${target.abs}.taskpilot-${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, opts.next, { mode: mode ?? 0o644 });
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, target.abs);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return { hash: hashOf(opts.next), backup };
}
