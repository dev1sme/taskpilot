import { afterAll, describe, expect, it } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import { createClaudePoller } from "../../../src/modules/usage/claude-poller.js";
import { UsageStore } from "../../../src/modules/usage/store.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

describe("createClaudePoller", () => {
  it("writes what /usage read and ignores a null read", async () => {
    const usage = new UsageStore(new StateStore(await tempDir("taskpilot-claude-poll-")));
    const errors: unknown[] = [];
    const results = [{ fiveHour: { usedPercentage: 20, resetsAt: null } }, null, new Error("boom")];
    const poller = createClaudePoller(
      usage,
      async () => {
        const next = results.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
      (e) => errors.push(e),
    );
    poller.start();
    await poller.idle();
    expect((await usage.view())!.fiveHour!.usedPercentage).toBe(20);
    poller.stop();
    expect(errors).toEqual([]);
  });
});
