import { afterAll, describe, expect, it } from "vitest";
import { UsageStore } from "../../../src/modules/usage/store.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

const RATE_LIMITS = {
  five_hour: { used_percentage: 85, resets_at: 1792477800 },
  seven_day: { used_percentage: 39, resets_at: 1792832400 },
};

const COPILOT = { usedPercentage: 10, unlimited: false, unit: "ai_credits", used: 30, entitlement: 300, resetsAt: null } as const;

afterAll(cleanupTempDirs);

describe("UsageStore", () => {
  it("keeps the last numbers when input has no rate limits, and ignores bad values", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({});
    await store.apply({ rate_limits: { five_hour: { used_percentage: "90" }, seven_day: { used_percentage: 140 } } });
    expect(await store.view()).toMatchObject({ fiveHour: { usedPercentage: 85 }, sevenDay: { usedPercentage: 39 } });
  });

  it("publishes only when the numbers change", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const seen: number[] = [];
    store.on("change", (u) => seen.push(u.fiveHour!.usedPercentage));
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({ rate_limits: { ...RATE_LIMITS, five_hour: { used_percentage: 86, resets_at: 1792477800 } } });
    expect(seen).toEqual([85, 86]);
  });

  it("keeps an agent's quota apart from Claude's numbers", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.applyAgent("copilot", COPILOT);
    expect(await store.view()).toEqual({ agents: { copilot: { ...COPILOT, updatedAt: expect.any(Number) } } });
    await store.apply({ rate_limits: RATE_LIMITS });
    expect(await store.view()).toMatchObject({ fiveHour: { usedPercentage: 85 }, agents: { copilot: { usedPercentage: 10 } } });
    await store.applyAgent("copilot", null);
    const view = await store.view();
    expect(view).toMatchObject({ fiveHour: { usedPercentage: 85 } });
    expect(view).not.toHaveProperty("agents");
  });

  it("publishes an agent's quota only when it changes", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const seen: (number | null | undefined)[] = [];
    store.on("change", (u) => seen.push(u.agents?.copilot?.usedPercentage));
    await store.applyAgent("copilot", null);
    await store.applyAgent("copilot", COPILOT);
    await store.applyAgent("copilot", COPILOT);
    await store.applyAgent("copilot", { ...COPILOT, usedPercentage: 12, used: 36 });
    expect(seen).toEqual([10, 12]);
  });

  it("reads gateway spend", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.apply({ rate_limits: { spend_limit: { used_percentage: 63 } } });
    expect(await store.view()).toMatchObject({ spend: { usedPercentage: 63 } });
  });
});
