import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCodexVersion } from "../../../src/providers/codex/version.js";

const FAKE = resolve(import.meta.dirname, "fake-app-server.mjs");

afterEach(() => {
  delete process.env.TASKPILOT_CODEX;
  vi.resetModules();
});

describe("parseCodexVersion", () => {
  it("reads the number from `codex --version`", () => {
    expect(parseCodexVersion("codex-cli 0.163.0\n")).toBe("0.163.0");
    expect(parseCodexVersion("codex-cli 0.164.0-alpha.2")).toBe("0.164.0-alpha.2");
    expect(parseCodexVersion("not a version")).toBeNull();
  });
});

describe("codexVersion", () => {
  it("runs the command once and keeps the answer", async () => {
    process.env.TASKPILOT_CODEX = FAKE;
    const { codexVersion } = await import("../../../src/providers/codex/version.js");
    await expect(codexVersion()).resolves.toBe("0.163.0");
    process.env.TASKPILOT_CODEX = "/no/such/codex";
    await expect(codexVersion()).resolves.toBe("0.163.0");
  });

  it("is null when the command is missing", async () => {
    process.env.TASKPILOT_CODEX = "/no/such/codex";
    const { codexVersion } = await import("../../../src/providers/codex/version.js");
    await expect(codexVersion()).resolves.toBeNull();
  });
});
