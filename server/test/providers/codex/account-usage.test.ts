import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchCodexRateLimits, parseCodexRateLimits } from "../../../src/providers/codex/account-usage.js";
import type { CodexRpc } from "../../../src/providers/codex/app-server.js";

const SNAPSHOT = {
  limitId: "codex",
  primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1792684986 },
  secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1793248622 },
  credits: { hasCredits: false, unlimited: false, balance: "0" },
  planType: "plus",
  rateLimitReachedType: null,
};

describe("parseCodexRateLimits", () => {
  it("reads the account/rateLimits/updated of the recorded turn", () => {
    const lines = readFileSync(resolve(import.meta.dirname, "../../fixtures/codex/turn.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean);
    const msg = lines.map((l) => JSON.parse(l).msg).find((m) => m?.method === "account/rateLimits/updated");
    expect(parseCodexRateLimits(msg.params)).toEqual({
      fiveHour: { usedPercentage: 0, resetsAt: 1792684986000 },
      sevenDay: { usedPercentage: 5, resetsAt: 1793248622000 },
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      planType: "plus",
      rateLimitReachedType: null,
    });
  });

  it("accepts a bare snapshot and prefers rateLimitsByLimitId.codex in a read response", () => {
    expect(parseCodexRateLimits(SNAPSHOT)).toMatchObject({ fiveHour: { usedPercentage: 12 } });
    const response = { rateLimits: SNAPSHOT, rateLimitsByLimitId: { codex: { ...SNAPSHOT, primary: { ...SNAPSHOT.primary, usedPercent: 40 } } } };
    expect(parseCodexRateLimits(response)).toMatchObject({ fiveHour: { usedPercentage: 40 } });
  });

  it("assigns windows by duration, not by primary/secondary", () => {
    const swapped = { primary: SNAPSHOT.secondary, secondary: SNAPSHOT.primary };
    expect(parseCodexRateLimits(swapped)).toMatchObject({ fiveHour: { usedPercentage: 12 }, sevenDay: { usedPercentage: 5 } });
    expect(parseCodexRateLimits({ primary: { usedPercent: 1, windowDurationMins: 60, resetsAt: 1 } })).toBeNull();
  });

  it("drops invalid fields one by one and ignores other limits", () => {
    const bad = { ...SNAPSHOT, primary: { usedPercent: 120, windowDurationMins: 300 }, credits: { hasCredits: "yes" }, planType: 3 };
    expect(parseCodexRateLimits(bad)).toEqual({ sevenDay: { usedPercentage: 5, resetsAt: 1793248622000 }, rateLimitReachedType: null });
    expect(parseCodexRateLimits({ ...SNAPSHOT, limitId: "codex_other" })).toBeNull();
    expect(parseCodexRateLimits(null)).toBeNull();
    expect(parseCodexRateLimits({ rateLimits: {} })).toBeNull();
  });

  it("keeps a missing resetsAt as null", () => {
    expect(parseCodexRateLimits({ primary: { usedPercent: 3, windowDurationMins: 300 } })).toEqual({ fiveHour: { usedPercentage: 3, resetsAt: null } });
  });
});

describe("fetchCodexRateLimits", () => {
  it("calls account/rateLimits/read and parses the answer", async () => {
    const calls: string[] = [];
    const rpc = { request: async (method: string) => (calls.push(method), { rateLimits: SNAPSHOT }) } as unknown as CodexRpc;
    expect(await fetchCodexRateLimits(rpc)).toMatchObject({ planType: "plus" });
    expect(calls).toEqual(["account/rateLimits/read"]);
  });
});
