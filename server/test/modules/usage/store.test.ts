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
  it("returns timestamped account evidence, never a lane failure, and expires old or reset observations", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-evidence-")));
    expect(await store.evidence("claude")).toBeNull();
    await store.apply({ rate_limits: { five_hour: { used_percentage: 100 } } });
    const observedAt = (await store.view())!.updatedAt!;
    expect(await store.evidence("claude", observedAt)).toEqual({
      scope: "account",
      agent: "claude",
      source: "claude-statusline",
      observedAt,
      validUntil: observedAt + 5 * 60_000,
      freshness: "fresh",
      exhausted: true,
    });
    expect(await store.evidence("claude", observedAt + 5 * 60_000 + 1)).toMatchObject({ freshness: "stale" });
    expect(await store.evidence("claude", observedAt - 1)).toMatchObject({ freshness: "stale" });
    expect(await store.evidence("codex")).toBeNull();
    await store.apply({ rate_limits: { five_hour: { used_percentage: 100, resets_at: (observedAt + 1000) / 1000 } } });
    expect(await store.evidence("claude", observedAt + 1001)).toMatchObject({ freshness: "stale", exhausted: false });
  });

  it("does not infer exhaustion from near-limit, unlimited, invalid or expired quota", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-evidence-")));
    await store.applyAgent("copilot", { ...COPILOT, usedPercentage: 99 });
    const at = (await store.view())!.agents!.copilot!.updatedAt;
    expect(await store.evidence("copilot", at)).toMatchObject({ scope: "account", source: "copilot-quota", freshness: "fresh", exhausted: false });
    await store.applyAgent("copilot", { ...COPILOT, usedPercentage: 100, unlimited: true });
    expect(await store.evidence("copilot")).toMatchObject({ exhausted: false });
    await store.applyAgent("copilot", { ...COPILOT, usedPercentage: 100, resetsAt: at - 1 });
    expect(await store.evidence("copilot")).toMatchObject({ freshness: "stale", exhausted: false });
    await store.apply({ rate_limits: { five_hour: { used_percentage: 101 } } });
    expect(await store.evidence("claude")).toBeNull();
    await store.applyAgent("copilot", null);
    expect(await store.evidence("copilot")).toBeNull();
  });

  it("keeps an expired window from making another active window exhausted", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-evidence-")));
    await store.apply({ rate_limits: { five_hour: { used_percentage: 100, resets_at: 1 }, seven_day: { used_percentage: 50 } } });
    expect(await store.evidence("claude")).toMatchObject({ freshness: "fresh", exhausted: false });
  });
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

  it("merges sparse Codex updates, publishes on change only, and gives no quota evidence", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const seen: unknown[] = [];
    store.on("change", (u) => seen.push(u.agents?.codex));
    await store.applyCodex(null);
    expect(await store.view()).toBeNull();
    const five = { usedPercentage: 100, resetsAt: Date.now() + 60_000 };
    await store.applyCodex({ fiveHour: five, planType: "plus" });
    await store.applyCodex({ sevenDay: { usedPercentage: 5, resetsAt: null } });
    await store.applyCodex({ sevenDay: { usedPercentage: 5, resetsAt: null } });
    expect(seen).toHaveLength(2);
    expect((await store.view())!.agents!.codex).toEqual({ fiveHour: five, sevenDay: { usedPercentage: 5, resetsAt: null }, planType: "plus", updatedAt: expect.any(Number) });
    expect(await store.evidence("codex")).toBeNull();
  });
});

describe("UsageStore.applyClaude", () => {
  it("merges the windows and keeps spend and the window it lacks", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-claude-usage-")));
    await store.apply({ rate_limits: { ...RATE_LIMITS, spend_limit: { used_percentage: 7 } } });
    await store.applyClaude({ fiveHour: { usedPercentage: 90, resetsAt: null } });
    expect(await store.view()).toMatchObject({
      fiveHour: { usedPercentage: 90, resetsAt: null },
      sevenDay: { usedPercentage: 39 },
      spend: { usedPercentage: 7 },
    });
    await store.applyClaude(null);
    await store.applyClaude({});
    expect((await store.view())!.fiveHour!.usedPercentage).toBe(90);
  });

  it("works before any status line and skips unchanged numbers within a minute", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-claude-usage-")));
    const fields = { sevenDay: { usedPercentage: 5, resetsAt: 1000 } };
    await store.applyClaude(fields);
    const at = (await store.view())!.updatedAt;
    await store.applyClaude(fields);
    expect((await store.view())!.updatedAt).toBe(at);
  });
});
