import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Temp repo with: DEMO-1 (spec + plan), DEMO-2 (nested spec only), NOSPEC (no spec dir). */
export async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "taskpilot-test-"));
  const tasks = path.join(repo, ".claude", "tasks");
  await mkdir(path.join(tasks, "DEMO-1", "spec"), { recursive: true });
  await writeFile(path.join(tasks, "DEMO-1", "spec", "req.md"), "# Health endpoint\n\nAdd /health.\n");
  await writeFile(path.join(tasks, "DEMO-1", "02-plan.md"), "# Plan\n");
  await writeFile(path.join(tasks, "DEMO-1", "notes.txt"), "not markdown");
  await mkdir(path.join(tasks, "DEMO-2", "spec", "ui"), { recursive: true });
  await writeFile(path.join(tasks, "DEMO-2", "spec", "ui", "screen.md"), "no heading here\n");
  await mkdir(path.join(tasks, "NOSPEC"), { recursive: true });
  await writeFile(path.join(tasks, "NOSPEC", "01-investigation.md"), "# x\n");
  await writeFile(path.join(repo, "secret.md"), "outside task dir\n");
  await symlink(path.join(repo, "secret.md"), path.join(tasks, "DEMO-1", "spec", "link.md"));
  return repo;
}
