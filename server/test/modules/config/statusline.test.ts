import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { statusLineCommand } from "../../../src/modules/config/settings/read.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const saved = { ...process.env };

let home: string;
afterAll(async () => {
  process.env = saved;
  await cleanupTempDirs();
});

beforeAll(async () => {
  home = await tempDir("taskpilot-home-");
  process.env.TASKPILOT_CLAUDE_HOME = home;
});

describe("statusLineCommand", () => {
  it("prefers local, then project, then user settings", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "user" } }));
    expect(await statusLineCommand(repo)).toBe("user");
    await mkdir(path.join(repo, ".claude"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "project" } }));
    expect(await statusLineCommand(repo)).toBe("project");
    await writeFile(path.join(repo, ".claude", "settings.local.json"), JSON.stringify({ statusLine: { type: "command", command: "local" } }));
    expect(await statusLineCommand(repo)).toBe("local");
  });

  it("returns null without a command status line", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ statusLine: { type: "static" } }));
    expect(await statusLineCommand(repo)).toBeNull();
  });
});
