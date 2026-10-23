import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import { createCodexPoller, fetchCodexUsage } from "../../../src/modules/usage/codex.js";
import { UsageStore } from "../../../src/modules/usage/store.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

const FAKE = resolve(import.meta.dirname, "../../core/codex/fake-app-server.mjs");
const ENV = ["TASKPILOT_CODEX", "FAKE_CODEX_COUNT_FILE", "FAKE_CODEX_LOGGED_OUT", "FAKE_CODEX_HANG_METHOD"];
const FIELDS = { fiveHour: { usedPercentage: 3, resetsAt: 1792684986000 }, planType: "plus" };

afterAll(cleanupTempDirs);
beforeEach(() => {
  process.env.TASKPILOT_CODEX = FAKE;
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
  vi.useRealTimers();
});

describe("fetchCodexUsage", () => {
  it("reads the account limits from a short-lived app-server", async () => {
    process.env.FAKE_CODEX_COUNT_FILE = resolve(await tempDir("taskpilot-codex-"), "count");
    const usage = await fetchCodexUsage();
    expect(usage).toMatchObject({ fiveHour: { usedPercentage: 3 }, sevenDay: { usedPercentage: 5 }, planType: "plus" });
    expect(readFileSync(process.env.FAKE_CODEX_COUNT_FILE, "utf8").trim().split("\n")).toEqual(["app-server --listen stdio://"]);
  });

  it("returns null when Codex is missing or signed out", async () => {
    process.env.TASKPILOT_CODEX = "/nonexistent/codex";
    await expect(fetchCodexUsage()).resolves.toBeNull();
    process.env.TASKPILOT_CODEX = FAKE;
    process.env.FAKE_CODEX_LOGGED_OUT = "1";
    await expect(fetchCodexUsage()).resolves.toBeNull();
  });

  it("gives up on an app-server that does not answer", async () => {
    process.env.FAKE_CODEX_HANG_METHOD = "account/rateLimits/read";
    await expect(fetchCodexUsage(300)).rejects.toThrow();
  });
});

describe("createCodexPoller", () => {
  async function setup(fetch: () => Promise<typeof FIELDS | null>, onError = vi.fn()) {
    const usage = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const spy = vi.fn(fetch);
    return { usage, spy, onError, poller: createCodexPoller(usage, spy, onError) };
  }

  it("fills agents.codex at start, before any session exists", async () => {
    const { usage, poller } = await setup(async () => FIELDS);
    poller.start();
    await poller.idle();
    expect((await usage.view())?.agents?.codex).toMatchObject(FIELDS);
    poller.stop();
  });

  it("reads at most once a minute and again every five minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const { spy, poller } = await setup(async () => FIELDS);
    poller.start();
    poller.request();
    await poller.idle();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await poller.idle();
    expect(spy).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reports a failed read, keeps the numbers and does not overlap reads", async () => {
    const { usage, spy, onError, poller } = await setup(async () => FIELDS);
    poller.request();
    await poller.idle();
    spy.mockRejectedValueOnce(new Error("boom"));
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    poller.request();
    poller.request();
    await poller.idle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((await usage.view())?.agents?.codex).toMatchObject(FIELDS);
  });
});
