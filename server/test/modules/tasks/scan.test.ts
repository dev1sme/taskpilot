import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getTask, listTasks, readTaskFile, resolveRepo } from "../../../src/modules/tasks/scan.js";
import { cleanupTempDirs, makeRepo } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

describe("listTasks", () => {
  it("lists only directories with markdown under spec/", async () => {
    const repo = await makeRepo();
    const keys = (await listTasks(repo)).map((t) => t.key).sort();
    expect(keys).toEqual(["DEMO-1", "DEMO-2"]);
  });

  it("derives title and files", async () => {
    const repo = await makeRepo();
    const demo1 = await getTask(repo, "DEMO-1");
    expect(demo1.title).toBe("Health endpoint");
    // The escaping symlink is not a regular file, so it is not listed.
    expect(demo1.specFiles.map((f) => f.path)).toEqual(["spec/req.md"]);
    expect(demo1.outputFiles.map((f) => f.path)).toEqual(["02-plan.md"]);

    const demo2 = await getTask(repo, "DEMO-2");
    expect(demo2.title).toBe("DEMO-2");
    expect(demo2.specFiles.map((f) => f.path)).toEqual(["spec/ui/screen.md"]);
  });

  it("lists the decision log but not archived documents", async () => {
    const repo = await makeRepo();
    const dir = path.join(repo, ".claude", "tasks", "DEMO-1");
    await writeFile(path.join(dir, "00-history.md"), "# log\n");
    await mkdir(path.join(dir, "archive", "20261020-150000"), { recursive: true });
    await writeFile(path.join(dir, "archive", "20261020-150000", "04-summary.md"), "# old\n");
    const demo1 = await getTask(repo, "DEMO-1");
    expect(demo1.outputFiles.map((f) => f.path)).toEqual(["00-history.md", "02-plan.md"]);
  });

  it("returns an empty list when .claude/tasks is missing", async () => {
    expect(await listTasks(await resolveRepo("/"))).toEqual([]);
  });
});

describe("readTaskFile", () => {
  it("reads spec and output files", async () => {
    const repo = await makeRepo();
    expect(await readTaskFile(repo, "DEMO-1", "spec/req.md")).toContain("Add /health");
    expect(await readTaskFile(repo, "DEMO-2", "spec/ui/screen.md")).toContain("no heading");
  });

  it.each([
    ["../../../secret.md"],
    ["spec/../../../../secret.md"],
    ["/etc/passwd.md"],
    ["notes.txt"],
    [""],
  ])("rejects %j", async (rel) => {
    const repo = await makeRepo();
    await expect(readTaskFile(repo, "DEMO-1", rel)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a symlink that escapes the task directory", async () => {
    const repo = await makeRepo();
    await expect(readTaskFile(repo, "DEMO-1", "spec/link.md")).rejects.toMatchObject({ status: 400 });
  });

  it("rejects invalid task keys", async () => {
    const repo = await makeRepo();
    await expect(readTaskFile(repo, "..", "spec/req.md")).rejects.toMatchObject({ status: 400 });
    await expect(getTask(repo, "../x")).rejects.toMatchObject({ status: 400 });
  });

  it("returns 404 for a missing file", async () => {
    const repo = await makeRepo();
    await expect(readTaskFile(repo, "DEMO-1", "04-summary.md")).rejects.toMatchObject({ status: 404 });
  });
});
