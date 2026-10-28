import { describe, expect, it } from "vitest";
import { backendOf } from "../../../src/modules/sessions/backends/index.js";

const common = { resume: true, repo: "/repo", model: "chosen", subagent: "worker", permissionMode: "auto" };
const meta = { nativeId: "thread-1", codex: { approvalsReviewer: "auto_review" as const, networkAccess: true } };

describe("provider launch option boundary", () => {
  it("only passes Codex state to Codex, preserving common options", () => {
    const codex = backendOf("codex").launchOptions(meta, common);
    expect(codex).toMatchObject({ ...common, ...meta });
    expect(codex.settings).toContain("SessionStart");
    const claude = backendOf("claude").launchOptions(meta, common);
    expect(claude).toMatchObject(common);
    expect(claude.settings).toContain("hooks");
    expect(claude).not.toHaveProperty("codex");
    expect(claude).not.toHaveProperty("nativeId");
    expect(backendOf("copilot").launchOptions(meta, common)).toEqual(common);
  });

  it("does not invent resume state or overrides during preflight", () => {
    expect(backendOf("codex").launchOptions({}, { resume: false })).toMatchObject({ resume: false, nativeId: undefined, codex: undefined });
  });
});
