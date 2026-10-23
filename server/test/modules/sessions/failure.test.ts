import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CodexError } from "../../../src/core/codex/errors.js";
import { StateStore } from "../../../src/core/state.js";
import { codexStartupFailure, codexTurnFailure } from "../../../src/modules/sessions/failure.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { UsageStore } from "../../../src/modules/usage/index.js";
import { buildApp } from "../../../src/app.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const FAKE = path.resolve(import.meta.dirname, "../../helpers/fake-codex.mjs");
const managers: SessionManager[] = [];
afterEach(() => managers.splice(0).forEach((manager) => manager.closeAll()));
afterAll(cleanupTempDirs);

describe("failure evidence", () => {
  it.each([
    ["not-logged-in", "auth"],
    ["bad-model", "unknown"],
  ])("uses recorded %s turn errors conservatively", async (scenario, reason) => {
    const lines = await readFile(path.resolve(import.meta.dirname, `../../fixtures/codex/${scenario}.jsonl`), "utf8");
    const records = lines
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const params = records.find((record) => record.dir === "recv" && record.msg.method === "turn/completed").msg.params;
    expect(codexTurnFailure(params.turn.error, params.threadId, params.turn.id).reason).toBe(reason);
  });
  it.each([
    ["usageLimitExceeded", "quota"],
    ["rateLimitExceeded", "unknown"],
    [{ httpConnectionFailed: { httpStatusCode: 429 } }, "unknown"],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, "auth"],
    ["unauthorized", "auth"],
    [{ responseStreamDisconnected: { httpStatusCode: null } }, "network"],
    ["sessionBudgetExceeded", "unknown"],
    ["other", "unknown"],
    [null, "unknown"],
    [{ usageLimitExceeded: true }, "unknown"],
  ])("classifies only verified structured info %j as %s", (codexErrorInfo, reason) => {
    const result = codexTurnFailure({ codexErrorInfo, message: "quota exhausted secret", additionalDetails: "secret" }, "thread", "turn");
    expect(result.reason).toBe(reason);
    expect(result.evidence).toMatchObject({ threadId: "thread", turnId: "turn" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    ["missing", "cli"],
    ["notLoggedIn", "auth"],
    ["modelUnknown", "model"],
    ["timeout", "unknown"],
    ["closed", "unknown"],
  ] as const)("keeps startup %s distinct from quota", (code, reason) => {
    expect(codexStartupFailure(new CodexError(code, "quota secret"))).toMatchObject({ reason });
    expect(codexStartupFailure(new Error("quota exhausted"))).toMatchObject({ reason: "unknown" });
  });
});

async function setup() {
  const repo = await makeRepo();
  const state = new StateStore(await tempDir("failure-state-"));
  const usage = new UsageStore(state);
  const launcher = () => ({ file: process.execPath, args: [FAKE] });
  const manager = new SessionManager(state, {
    launchers: { claude: launcher, copilot: launcher, codex: launcher },
    accountQuota: (agent) => usage.evidence(agent),
  });
  managers.push(manager);
  let stops = 0;
  manager.on("hook", (_meta, event) => {
    if (event === "Stop") stops++;
  });
  const session = await manager.create(repo, "DEMO-1", { agent: "codex" });
  const turn = async (prompt: string) => {
    const expected = stops + 1;
    manager.paste(session.id, prompt);
    await vi.waitFor(() => expect(stops).toBe(expected));
    return manager.get(session.id);
  };
  return { manager, state, usage, repo, session, turn };
}

describe("session failure integration", () => {
  it("exposes startup model errors as model evidence without leaking backend detail", async () => {
    const { manager, repo } = await setup();
    await expect(manager.create(repo, "DEMO-1", { agent: "codex", model: "unavailable-model" })).rejects.toMatchObject({ status: 400 });
    const failed = (await manager.list(repo, "DEMO-1")).find((session) => session.model === "unavailable-model");
    expect(failed?.failure).toMatchObject({ reason: "model", evidence: { source: "codex-startup", code: "modelUnknown" } });
  });
  it.each([
    ["quota", "quota"],
    ["rate", "unknown"],
    ["http429", "unknown"],
    ["auth", "auth"],
    ["network", "network"],
    ["unknown", "unknown"],
  ])("projects final %s evidence through SessionManager", async (kind, reason) => {
    const { manager, session, turn } = await setup();
    const result = await turn(`FAILURE:${kind}`);
    expect(result.failure).toMatchObject({ reason, generation: session.generation, observedAt: expect.any(Number), evidence: { turnId: expect.any(String), threadId: session.nativeId } });
    expect(JSON.stringify(result.failure)).not.toContain("fixture-secret");
    expect((await manager.list(session.repo, session.taskKey))[0].failure).toEqual(result.failure);
    expect(result.status).toBe("running");
  });

  it.each(["retry", "stale"])("does not turn %s notifications into a quota failure", async (kind) => {
    const { turn } = await setup();
    expect((await turn(`FAILURE:${kind}`)).failure).toBeUndefined();
  });

  it("clears previous evidence on a new prompt and spawn, without automatically switching", async () => {
    const { manager, session, state, turn } = await setup();
    await turn("FAILURE:quota");
    expect(await manager.list(session.repo, session.taskKey)).toHaveLength(1);
    const previous = (await manager.get(session.id)).failure;
    manager.paste(session.id, "SLOW");
    await vi.waitFor(async () => expect((await manager.get(session.id)).failure).toBeUndefined());
    await manager.stopAndWait(session.id);
    await manager.resume(session.id);
    expect((await manager.get(session.id)).failure).toBeUndefined();
    expect(previous?.reason).toBe("quota");
    expect((await state.load()).sessions).toHaveLength(1);
  });

  it("does not invent turn evidence from account usage, timeout/no-hook text or after manager restart", async () => {
    const { manager, session, state, usage, turn } = await setup();
    await usage.apply({ rate_limits: { five_hour: { used_percentage: 100 } } });
    await usage.applyAgent("copilot", { usedPercentage: 100, unlimited: false, unit: "premium_requests", used: 300, entitlement: 300, resetsAt: null });
    expect((await turn("FAILURE:unknown")).failure?.reason).toBe("unknown");
    const restored = new SessionManager(new StateStore(state.dir));
    managers.push(restored);
    expect((await restored.get(session.id)).failure).toBeUndefined();
    expect((await manager.get(session.id)).accountQuota).toBeUndefined(); // No Codex account quota adapter.
    expect(codexStartupFailure(new Error("timeout no-hook usage exceeded"))).toMatchObject({ reason: "unknown" });
  });

  it("declares adapter coverage independently of login/inventory", async () => {
    const { manager, repo } = await setup();
    const result = await manager.capabilities(repo);
    expect(result.agents.find((item) => item.agent === "codex")?.quotaDetection).toEqual({ status: "supported", source: "adapter" });
    for (const agent of ["claude", "copilot"]) expect(result.agents.find((item) => item.agent === agent)?.quotaDetection.status).toBe("unknown");
  });

  it("wires account evidence into session HTTP views without blaming the turn", async () => {
    const repo = await makeRepo();
    const state = new StateStore(await tempDir("failure-http-"));
    const usage = new UsageStore(state);
    await usage.apply({ rate_limits: { five_hour: { used_percentage: 100 } } });
    const observedAt = (await usage.view())!.updatedAt;
    await state.update((saved) => saved.sessions.push({ id: "source", repo, taskKey: "DEMO-1", title: "Source", createdAt: 1 }));
    const app = await buildApp({ state, repo, token: "test-token" });
    try {
      const response = await app.inject({ method: "GET", url: "/api/tasks/DEMO-1/sessions", headers: { host: "127.0.0.1:8790", "x-taskpilot-token": "test-token" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()[0]).toMatchObject({ accountQuota: { scope: "account", source: "claude-statusline", observedAt, freshness: "fresh", exhausted: true } });
      expect(response.json()[0]).not.toHaveProperty("failure");
    } finally {
      await app.close();
    }
  });
});
