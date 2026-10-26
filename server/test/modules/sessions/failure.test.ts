import { afterAll, afterEach, describe, expect, it } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import { SessionManager } from "../../../src/modules/sessions/index.js";
import { UsageStore } from "../../../src/modules/usage/index.js";
import { buildApp } from "../../../src/app.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

const managers: SessionManager[] = [];
afterEach(() => managers.splice(0).forEach((manager) => manager.closeAll()));
afterAll(cleanupTempDirs);

function token(manager: SessionManager, id: string) {
  return (manager as unknown as { live: Map<string, { hookToken: string }> }).live.get(id)!.hookToken;
}

describe("session failure integration", () => {
  it("shows a failed Stop as an unclassified failure, clears it on the next prompt and spawn", async () => {
    const repo = await makeRepo();
    const state = new StateStore(await tempDir("failure-state-"));
    const manager = new SessionManager(state, { launcher: () => ({ file: "/bin/sh", args: ["-c", "while read -r line; do :; done"] }) });
    managers.push(manager);
    const session = await manager.create(repo, "DEMO-1");
    const hook = (event: Parameters<SessionManager["handleHook"]>[1], payload: Record<string, unknown> = {}) =>
      manager.handleHook(token(manager, session.id), event, { session_id: session.id, ...payload });
    expect(await hook("Stop", { failed: true })).toBe(true);
    const failed = await manager.get(session.id);
    expect(failed.failure).toMatchObject({ reason: "unknown", generation: session.generation, observedAt: expect.any(Number), evidence: { source: "unclassified" } });
    expect((await manager.list(repo, "DEMO-1"))[0].failure).toEqual(failed.failure);
    expect(failed.status).toBe("running");
    expect(await hook("UserPromptSubmit")).toBe(true);
    expect((await manager.get(session.id)).failure).toBeUndefined();
    await hook("Stop", { failed: true });
    await manager.stopAndWait(session.id);
    await manager.resume(session.id);
    expect((await manager.get(session.id)).failure).toBeUndefined();
    await manager.stopAndWait(session.id);
  });

  it("does not invent a failure from account usage or after a manager restart", async () => {
    const repo = await makeRepo();
    const state = new StateStore(await tempDir("failure-restart-"));
    const usage = new UsageStore(state);
    const manager = new SessionManager(state, { launcher: () => ({ file: "/bin/sh", args: ["-c", "while read -r line; do :; done"] }), accountQuota: (agent) => usage.evidence(agent) });
    managers.push(manager);
    const session = await manager.create(repo, "DEMO-1");
    await usage.apply({ rate_limits: { five_hour: { used_percentage: 100 } } });
    expect((await manager.get(session.id)).failure).toBeUndefined();
    await manager.handleHook(token(manager, session.id), "Stop", { session_id: session.id, failed: true });
    const restored = new SessionManager(new StateStore(state.dir));
    managers.push(restored);
    expect((await restored.get(session.id)).failure).toBeUndefined();
    await manager.stopAndWait(session.id);
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
