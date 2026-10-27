import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const created: string[] = [];

/** Temp directory removed by `cleanupTempDirs` (call it from afterAll). */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

/** Temp repo with: DEMO-1 (spec + plan), DEMO-2 (nested spec only), NOSPEC (no spec dir). */
export async function makeRepo(): Promise<string> {
  const repo = await tempDir("taskpilot-test-");
  const tasks = path.join(repo, ".claude", "tasks");
  await mkdir(path.join(tasks, "DEMO-1", "spec"), { recursive: true });
  await writeFile(path.join(tasks, "DEMO-1", "spec", "req.md"), "# Health endpoint\n\nAdd /health.\n");
  await writeFile(path.join(tasks, "DEMO-1", "02-plan.md"), "# Plan\n");
  await writeFile(path.join(tasks, "DEMO-1", "notes.txt"), "not markdown");
  await mkdir(path.join(tasks, "DEMO-2", "spec", "ui"), { recursive: true });
  await writeFile(path.join(tasks, "DEMO-2", "spec", "ui", "screen.md"), "no heading here\n");
  await mkdir(path.join(tasks, "NOSPEC"), { recursive: true });
  await writeFile(path.join(tasks, "NOSPEC", "notes-old.md"), "# x\n");
  await writeFile(path.join(repo, "secret.md"), "outside task dir\n");
  await symlink(path.join(repo, "secret.md"), path.join(tasks, "DEMO-1", "spec", "link.md"));
  return repo;
}
