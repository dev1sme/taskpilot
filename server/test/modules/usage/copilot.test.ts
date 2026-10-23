import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { CopilotQuotaResult } from "../../../src/core/copilot/quota.js";
import { createCopilotPoller, parseCopilotQuota } from "../../../src/modules/usage/copilot.js";
import { UsageStore } from "../../../src/modules/usage/store.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

/** As copilot 1.0.101 returned it for a Business account on usage-based billing. */
const UNLIMITED = {
  chat: { isUnlimitedEntitlement: true, entitlementRequests: 0, remainingPercentage: 100 },
  premium_interactions: {
    isUnlimitedEntitlement: true,
    entitlementRequests: 0,
    usedRequests: 0,
    usageAllowedWithExhaustedQuota: true,
    overage: 0,
    overageAllowedWithExhaustedQuota: true,
    remainingPercentage: 100,
    resetDate: "2026-10-21T03:24:57.899Z",
    hasQuota: true,
    tokenBasedBilling: true,
    overageEntitlement: 0,
  },
};

const LIMITED = {
  premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 300, usedRequests: 30, remainingPercentage: 90, resetDate: "2026-11-01T00:00:00Z" },
};

afterAll(cleanupTempDirs);
afterEach(() => {
  vi.useRealTimers();
});

describe("parseCopilotQuota", () => {
  it("reads an unlimited account without a percentage or reset", () => {
    expect(parseCopilotQuota(UNLIMITED)).toEqual({ usedPercentage: null, unlimited: true, unit: "ai_credits", used: 0, entitlement: null, resetsAt: null });
  });

  it("reads a limited account on premium requests", () => {
    expect(parseCopilotQuota(LIMITED)).toEqual({
      usedPercentage: 10,
      unlimited: false,
      unit: "premium_requests",
      used: 30,
      entitlement: 300,
      resetsAt: Date.parse("2026-11-01T00:00:00Z"),
    });
  });

  it("treats a negative entitlement as unlimited", () => {
    expect(parseCopilotQuota({ premium_interactions: { entitlementRequests: -1 } })).toMatchObject({ unlimited: true, usedPercentage: null });
  });

  it("guards keys and fields the runtime sets", () => {
    expect(parseCopilotQuota(null)).toBeNull();
    expect(parseCopilotQuota({ chat: LIMITED.premium_interactions })).toBeNull();
    expect(parseCopilotQuota({ premium_interactions: [] })).toBeNull();
    expect(parseCopilotQuota({ premium_interactions: { remainingPercentage: "90" } })).toBeNull();
    expect(parseCopilotQuota({ premium_interactions: { remainingPercentage: 140 } })).toBeNull();
    expect(parseCopilotQuota({ premium_interactions: { remainingPercentage: 50, usedRequests: "3", resetDate: "soon" } })).toEqual({
      usedPercentage: 50,
      unlimited: false,
      unit: "premium_requests",
      used: null,
      entitlement: null,
      resetsAt: null,
    });
  });
});

describe("createCopilotPoller", () => {
  async function setup(results: CopilotQuotaResult[]) {
    const usage = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const fetch = vi.fn(async () => results.shift() ?? { ok: true as const, snapshots: LIMITED });
    return { usage, fetch, poller: createCopilotPoller(usage, fetch) };
  }

  it("reads at most once a minute and still reads after the last turn", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { usage, fetch, poller } = await setup([]);
    poller.request();
    await poller.idle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await usage.view())?.agents?.copilot).toMatchObject({ usedPercentage: 10 });

    await vi.advanceTimersByTimeAsync(10_000);
    poller.request();
    poller.request();
    await vi.advanceTimersByTimeAsync(49_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await poller.idle();
    expect(fetch).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("never starts a read while one is running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { fetch, poller } = await setup([]);
    let release!: () => void;
    fetch.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: false, reason: "failed" }))));
    poller.request();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    poller.request();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await poller.idle();
    expect(fetch).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("removes the quota when Copilot is missing or logged out, and keeps it on other failures", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { usage, poller } = await setup([
      { ok: true, snapshots: UNLIMITED },
      { ok: false, reason: "failed" },
      { ok: false, reason: "unauthenticated" },
    ]);
    const read = async () => {
      poller.request();
      await poller.idle();
      await vi.advanceTimersByTimeAsync(60_000);
      return (await usage.view())?.agents?.copilot;
    };
    expect(await read()).toMatchObject({ unlimited: true });
    expect(await read()).toMatchObject({ unlimited: true });
    expect(await read()).toBeUndefined();
    poller.stop();
  });
});
