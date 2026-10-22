import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codexModelProblem, codexModels, resetCodexModelsCache } from "../../../src/core/codex/models.js";

const FAKE = resolve(import.meta.dirname, "fake-app-server.mjs");
let countFile: string;
const starts = () => readFileSync(countFile, "utf8").split("\n").filter(Boolean).length;
const ENV = ["TASKPILOT_CODEX", "FAKE_CODEX_COUNT_FILE", "FAKE_CODEX_MODELS", "FAKE_CODEX_PAGES", "FAKE_CODEX_FAIL"];

beforeEach(() => {
  countFile = join(mkdtempSync(join(tmpdir(), "codex-models-")), "count");
  process.env.TASKPILOT_CODEX = FAKE;
  process.env.FAKE_CODEX_COUNT_FILE = countFile;
  resetCodexModelsCache();
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
  vi.useRealTimers();
});

describe("codexModels", () => {
  it("reads the model list of handshake.jsonl", async () => {
    const models = await codexModels();
    expect(models.map((m) => m.model)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
    expect(models.filter((m) => m.isDefault).map((m) => m.model)).toEqual(["gpt-6.1-sol"]);
    expect(models[0]).toMatchObject({ id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol" });
  });

  it("follows nextCursor over pages", async () => {
    process.env.FAKE_CODEX_PAGES = "1";
    expect(await codexModels()).toHaveLength(7);
  });

  it("starts one app-server per ten minutes, shared by calls made at once", async () => {
    await Promise.all([codexModels(), codexModels()]);
    await codexModels();
    expect(starts()).toBe(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await codexModels();
    expect(starts()).toBe(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await codexModels();
    expect(starts()).toBe(2);
  });

  it("does not cache a failure", async () => {
    process.env.FAKE_CODEX_FAIL = "1";
    await expect(codexModels()).rejects.toMatchObject({ code: "closed", message: expect.stringContaining("boom") });
    delete process.env.FAKE_CODEX_FAIL;
    expect(await codexModels()).toHaveLength(7);
  });

  it("rejects a model/list entry without a name as a protocol error", async () => {
    process.env.FAKE_CODEX_MODELS = JSON.stringify([{ hidden: false }]);
    await expect(codexModels()).rejects.toMatchObject({ code: "protocol" });
  });
});

describe("codexModelProblem", () => {
  it("is null for a model of the account, by model or id", async () => {
    await expect(codexModelProblem("gpt-6-astra")).resolves.toBeNull();
  });

  it("names the model and lists what the account offers", async () => {
    const problem = await codexModelProblem("gpt-no-such-model-probe");
    expect(problem).toMatchObject({ kind: "unknown", model: "gpt-no-such-model-probe" });
    expect(problem?.kind === "unknown" && problem.available).toContain("gpt-6.1-sol");
    expect(problem?.message).toContain("gpt-no-such-model-probe");
  });

  it("reports a list it cannot read apart from an unknown model", async () => {
    process.env.TASKPILOT_CODEX = "/no/such/codex";
    const problem = await codexModelProblem("gpt-6.1-sol");
    expect(problem).toMatchObject({ kind: "unavailable", model: "gpt-6.1-sol" });
    expect(problem?.kind === "unavailable" && problem.error).toMatchObject({ code: "missing" });
  });
});
