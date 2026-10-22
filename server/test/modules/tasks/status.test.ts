import { readdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import { doneOf, readTaskStatus, TASK_STATUS_FILE, writeTaskStatus } from "../../../src/modules/tasks/status.js";
import { getTask } from "../../../src/modules/tasks/scan.js";
import { cleanupTempDirs, makeRepo } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const taskDir = (repo: string) => path.join(repo, ".claude", "tasks", "DEMO-1");

describe("task status file", () => {
  it("writes done with its date and open without, and reads them back", async () => {
    const dir = taskDir(await makeRepo());
    expect(await readTaskStatus(dir)).toBeNull();

    const at = new Date("2026-10-22T08:30:00.000Z");
    expect(await writeTaskStatus(dir, "done", at)).toEqual({ status: "done", doneAt: at.getTime() });
    expect(await readFile(path.join(dir, TASK_STATUS_FILE), "utf8")).toBe("# Written by TaskPilot: status is open or done.\nstatus: done\ndoneAt: 2026-10-22T08:30:00.000Z\n");
    expect(await readTaskStatus(dir)).toEqual({ status: "done", doneAt: at.getTime() });

    expect(await writeTaskStatus(dir, "open")).toEqual({ status: "open", doneAt: null });
    expect(await readTaskStatus(dir)).toEqual({ status: "open", doneAt: null });
    // No temp file left behind.
    expect((await readdir(dir)).filter((f) => f.startsWith(TASK_STATUS_FILE))).toEqual([TASK_STATUS_FILE]);
  });

  it.each([["not: [valid"], ["status: finished\n"], ["- done\n"], [""]])("treats %j as no status", async (content) => {
    const dir = taskDir(await makeRepo());
    await writeFile(path.join(dir, TASK_STATUS_FILE), content);
    expect(await readTaskStatus(dir)).toBeNull();
  });

  it("keeps a hand-written done without a valid date", async () => {
    const dir = taskDir(await makeRepo());
    await writeFile(path.join(dir, TASK_STATUS_FILE), "status: done\ndoneAt: yesterday\n");
    expect(await readTaskStatus(dir)).toEqual({ status: "done", doneAt: null });
  });

  it("is part of the task summary but not one of its documents", async () => {
    const repo = await makeRepo();
    await writeTaskStatus(taskDir(repo), "done", new Date(1000));
    const task = await getTask(repo, "DEMO-1");
    expect(task.status).toEqual({ status: "done", doneAt: 1000 });
    expect(task.outputFiles.map((f) => f.path)).toEqual(["02-plan.md"]);
    expect((await getTask(repo, "DEMO-2")).status).toBeNull();
  });
});

describe("doneOf", () => {
  it("lets the file decide and falls back to the run's phase without it", () => {
    expect(doneOf({ status: "done", doneAt: 5 }, undefined)).toEqual({ at: 5 });
    expect(doneOf({ status: "done", doneAt: null }, "running")).toEqual({ at: null });
    expect(doneOf({ status: "open", doneAt: null }, "done")).toBeNull();
    expect(doneOf(null, "done")).toEqual({ at: null });
    expect(doneOf(null, "cancelled")).toBeNull();
    expect(doneOf(null, undefined)).toBeNull();
  });
});
