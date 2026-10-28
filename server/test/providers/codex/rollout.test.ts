import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path, { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolloutTokens } from "../../../src/providers/codex/rollout.js";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures/codex-tui");

describe("rolloutTokens", () => {
  it("reads the thread total of the last token_count in a real rollout", async () => {
    expect(await rolloutTokens(path.join(FIXTURES, "rollout-approval-then-resume.jsonl"))).toEqual({ inputTokens: 65187, outputTokens: 248 });
  });

  it("yields nothing for a missing file or one without token_count", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rollout-"));
    const empty = path.join(dir, "empty.jsonl");
    writeFileSync(empty, '{"type":"event_msg","payload":{"type":"agent_message"}}\nnot json\n');
    expect(await rolloutTokens(path.join(dir, "missing.jsonl"))).toEqual({});
    expect(await rolloutTokens(empty)).toEqual({});
  });
});
