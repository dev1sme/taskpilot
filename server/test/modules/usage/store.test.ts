import { afterAll, describe, expect, it } from "vitest";
import { UsageStore } from "../../../src/modules/usage/store.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

const RATE_LIMITS = {
  five_hour: { used_percentage: 85, resets_at: 1792477800 },
  seven_day: { used_percentage: 39, resets_at: 1792832400 },
};

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

  it("reads gateway spend", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.apply({ rate_limits: { spend_limit: { used_percentage: 63 } } });
    expect(await store.view()).toMatchObject({ spend: { usedPercentage: 63 } });
  });
});
