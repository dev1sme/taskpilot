import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fetchClaudeUsage, parseClaudeUsageReport } from "../../../src/core/claude/usage.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

const REPORT = {
  type: "assistant",
  usage_report: {
    rate_limits: {
      limits: [
        { kind: "session", percent: 12, resets_at: null },
        { kind: "weekly_all", percent: 100, resets_at: "2026-10-24T09:00:00.334240+00:00" },
        { kind: "weekly_scoped", percent: 50, resets_at: null },
      ],
    },
  },
};
const LINE = JSON.stringify(REPORT);

afterAll(cleanupTempDirs);
afterEach(() => {
  delete process.env.TASKPILOT_CLAUDE;
});

describe("parseClaudeUsageReport", () => {
  it("maps session to 5h and weekly_all to 7d, ignoring other lines and kinds", () => {
    const out = parseClaudeUsageReport(`{"type":"system"}\nnot json\n${LINE}\n`);
    expect(out).toEqual({
      fiveHour: { usedPercentage: 12, resetsAt: null },
      sevenDay: { usedPercentage: 100, resetsAt: Date.parse("2026-10-24T09:00:00.334240+00:00") },
    });
  });

  it("returns null for a null, missing or malformed report", () => {
    const nulled = { usage_report: { rate_limits: null } };
    expect(parseClaudeUsageReport(JSON.stringify(nulled))).toBeNull();
    expect(parseClaudeUsageReport(JSON.stringify({ usage_report: { rate_limits: { limits: [{ kind: "session", percent: 101 }, "x"] } } }))).toBeNull();
    expect(parseClaudeUsageReport("")).toBeNull();
  });
});

describe("fetchClaudeUsage", () => {
  async function fake(body: string): Promise<string> {
    const file = resolve(await tempDir("taskpilot-claude-usage-"), "claude");
    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o755);
    return file;
  }

  it("runs /usage without a transcript and parses the report", async () => {
    process.env.TASKPILOT_CLAUDE = await fake(`case "$*" in *"-p /usage"*"--no-session-persistence"*) echo '${LINE}';; esac`);
    await expect(fetchClaudeUsage()).resolves.toMatchObject({ fiveHour: { usedPercentage: 12 } });
  });

  it("returns null when claude is missing and rejects when it fails without output", async () => {
    process.env.TASKPILOT_CLAUDE = "/nonexistent/claude";
    await expect(fetchClaudeUsage()).resolves.toBeNull();
    process.env.TASKPILOT_CLAUDE = await fake("exit 1");
    await expect(fetchClaudeUsage()).rejects.toThrow();
  });
});
