import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copilotModels, resetCopilotModelsCache } from "../../../src/providers/copilot/models.js";

const FAKE = resolve(import.meta.dirname, "fake-acp.mjs");
const FIXTURE_SESSION = "00000000-0000-4000-8000-000000000001";
let dir: string;
let countFile: string;
const starts = () => readFileSync(countFile, "utf8").split("\n").filter(Boolean);
const ENV = ["TASKPILOT_COPILOT", "COPILOT_HOME", "FAKE_COPILOT_COUNT_FILE", "FAKE_COPILOT_MODELS", "FAKE_COPILOT_FAIL"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "copilot-models-"));
  countFile = join(dir, "count");
  process.env.TASKPILOT_COPILOT = FAKE;
  process.env.COPILOT_HOME = join(dir, "home");
  process.env.FAKE_COPILOT_COUNT_FILE = countFile;
  resetCopilotModelsCache();
});
afterEach(() => {
  for (const key of ENV) delete process.env[key];
  vi.useRealTimers();
});

describe("copilotModels", () => {
  it("reads the account models of acp-handshake.jsonl, auto once, marking the current one", async () => {
    const models = await copilotModels();
    expect(models.map((m) => m.model)).toEqual([
      "auto",
      "claude-sonnet-5.5",
      "claude-sonnet-5",
      "claude-opus-5.5",
      "claude-opus-5",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.3-codex",
      "gemini-3.8-flash",
      "grok-4.7",
      "grok-4.6",
    ]);
    expect(models.find((m) => m.model === "auto")?.usage).toBe("1x");
    expect(models.filter((m) => m.isDefault).map((m) => m.model)).toEqual(["claude-sonnet-5.5"]);
  });

  it("leaves out models the account has not enabled", async () => {
    process.env.FAKE_COPILOT_MODELS = JSON.stringify([
      { modelId: "a", name: "A", _meta: { copilotEnablement: "enabled" } },
      { modelId: "b", name: "B", _meta: { copilotEnablement: "disabled" } },
    ]);
    expect((await copilotModels()).map((m) => m.model)).toEqual(["a"]);
  });

  it("starts one copilot --acp per ten minutes in a scratch directory, shared by calls made at once", async () => {
    await Promise.all([copilotModels(), copilotModels()]);
    await copilotModels();
    expect(starts()).toHaveLength(1);
    expect(starts()[0]).toMatch(/^--acp\|.*taskpilot-copilot-acp-/);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await copilotModels();
    expect(starts()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await copilotModels();
    expect(starts()).toHaveLength(2);
  });

  it("removes the session directory copilot leaves behind", async () => {
    mkdirSync(join(dir, "home", "session-state", FIXTURE_SESSION), { recursive: true });
    await copilotModels();
    expect(existsSync(join(dir, "home", "session-state", FIXTURE_SESSION))).toBe(false);
  });

  it("does not cache a failure", async () => {
    process.env.FAKE_COPILOT_FAIL = "1";
    await expect(copilotModels()).rejects.toMatchObject({ code: "closed", message: expect.stringContaining("boom") });
    delete process.env.FAKE_COPILOT_FAIL;
    expect(await copilotModels()).toHaveLength(15);
  });

  it("rejects an entry without modelId as a protocol error", async () => {
    process.env.FAKE_COPILOT_MODELS = JSON.stringify([{ name: "x" }]);
    await expect(copilotModels()).rejects.toMatchObject({ code: "protocol" });
  });
});
