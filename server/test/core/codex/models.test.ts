import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCodexModels } from "../../../src/core/codex/models.js";
import { initializeCodex, spawnCodex } from "../../../src/core/codex/rpc.js";

const FAKE = resolve(import.meta.dirname, "fake-app-server.mjs");
const ENV = ["TASKPILOT_CODEX", "FAKE_CODEX_MODELS", "FAKE_CODEX_PAGES"];

beforeEach(() => {
  process.env.TASKPILOT_CODEX = FAKE;
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
});

/** Reads the model list over a fresh fake app-server, the way the probe does. */
async function list() {
  const proc = await spawnCodex();
  try {
    await initializeCodex(proc.rpc);
    return await listCodexModels(proc.rpc);
  } finally {
    proc.kill();
  }
}

describe("listCodexModels", () => {
  it("reads the model list of handshake.jsonl", async () => {
    const models = await list();
    expect(models.map((m) => m.model)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(models.filter((m) => m.isDefault).map((m) => m.model)).toEqual(["gpt-6.1-sol"]);
    expect(models[0]).toMatchObject({ id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol" });
  });

  it("follows nextCursor over pages", async () => {
    process.env.FAKE_CODEX_PAGES = "1";
    expect(await list()).toHaveLength(7);
  });

  it("rejects a model/list entry without a name as a protocol error", async () => {
    process.env.FAKE_CODEX_MODELS = JSON.stringify([{ hidden: false }]);
    await expect(list()).rejects.toMatchObject({ code: "protocol" });
  });
});
