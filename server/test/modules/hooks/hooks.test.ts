import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../src/app.js";
import { StateStore } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

const TOKEN = "test-token";

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());
afterAll(cleanupTempDirs);

describe("hook route", () => {
  it("logs a hook it refuses, since the hook command swallows the error", async () => {
    app = await buildApp({ token: TOKEN, state: new StateStore(await tempDir("taskpilot-state-")) });
    const warn = vi.spyOn(app.log, "warn");
    const post = (headers: Record<string, string>) => app!.inject({ method: "POST", url: "/hook/Stop", headers: { host: "127.0.0.1:8790", ...headers }, payload: {} });

    expect((await post({ "x-taskpilot-hook-token": "stale" })).statusCode).toBe(403);
    expect(warn).toHaveBeenLastCalledWith({ event: "Stop", hasToken: true }, expect.stringContaining("refused"));
    expect((await post({})).statusCode).toBe(403);
    expect(warn).toHaveBeenLastCalledWith({ event: "Stop", hasToken: false }, expect.stringContaining("refused"));
  });
});
