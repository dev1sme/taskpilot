import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rolloutIdentity, rolloutTokens } from "../../../src/providers/codex/rollout.js";

let dir: string;
let file: string;
const head = (id = "root", source: unknown = "cli") => JSON.stringify({ type: "session_meta", payload: { id, source, cwd: "/repo" } }) + "\n";
const sample = (input: unknown, output: unknown = 3) =>
  JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 999 } } } }) + "\n";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tpl039-rollout-"));
  file = path.join(dir, "rollout.jsonl");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bounded Codex cumulative measurements", () => {
  it("reads the final cumulative sample, preserves measured zero and source ordering", async () => {
    await writeFile(file, head() + sample(15) + sample(0, 0));
    const result = await rolloutTokens(file, "root");
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, availability: { state: "available" }, sample: { nativeId: "root" } });
    expect(result.sample!.offset).toBe(Buffer.byteLength(head() + sample(15) + sample(0, 0)));
    expect(result).not.toHaveProperty("cachedInputTokens");
    expect((await rolloutTokens(file, "root")).sample).toEqual(result.sample);
  });
  it("does not zero-fill missing, negative or invalid counters", async () => {
    await writeFile(file, head() + sample(-1, null));
    expect(await rolloutTokens(file, "root")).toMatchObject({ availability: { state: "missing", reason: "invalid-rollout" } });
    await writeFile(file, head() + sample(undefined, 4));
    const result = await rolloutTokens(file, "root");
    expect(result.outputTokens).toBe(4);
    expect(result).not.toHaveProperty("inputTokens");
  });
  it("ignores torn final lines and malformed samples without throwing", async () => {
    await writeFile(file, head() + sample(10) + '{"token_count":broken}\n' + sample(999).trimEnd());
    expect((await rolloutTokens(file, "root")).inputTokens).toBe(10);
  });
  it("reports missing files, unreadable types, missing samples and mismatched identity", async () => {
    expect((await rolloutTokens(file, "root")).availability.reason).toBe("file-missing");
    await mkdir(file);
    expect((await rolloutTokens(file, "root")).availability.reason).toBe("file-unreadable");
    await rm(file, { recursive: true });
    await writeFile(file, head());
    expect((await rolloutTokens(file, "root")).availability.reason).toBe("no-sample");
    await writeFile(file, head("other") + sample(100));
    expect((await rolloutTokens(file, "root")).availability).toMatchObject({ state: "unverified", reason: "identity-mismatch" });
  });
  it("reads a session_meta line that embeds long instructions", async () => {
    const meta = JSON.stringify({ type: "session_meta", payload: { id: "root", source: "cli", cwd: "/repo", base_instructions: "i".repeat(200 << 10) } }) + "\n";
    await writeFile(file, meta + sample(7));
    expect(await rolloutIdentity(file)).toMatchObject({ id: "root", source: "cli" });
    expect((await rolloutTokens(file, "root")).inputTokens).toBe(7);
  });
  it("rejects child rollouts and symlink targets", async () => {
    await writeFile(file, head("root", { subagent: { thread_spawn: { parent_thread_id: "parent" } } }) + sample(100));
    expect((await rolloutTokens(file, "root")).availability.reason).toBe("identity-mismatch");
    const link = path.join(dir, "link");
    await symlink(file, link);
    expect(await rolloutIdentity(link)).toBeNull();
    expect((await rolloutTokens(link, "root")).availability.reason).toBe("file-unreadable");
  });
  it("does not scan the whole file to recover a sample outside the tail", async () => {
    await writeFile(file, head() + sample(100) + "x".repeat((1 << 20) + 100) + "\n");
    expect((await rolloutTokens(file, "root")).availability.reason).toBe("no-sample");
    await writeFile(file, head() + "x".repeat(1 << 20) + "\n" + sample(7));
    expect((await rolloutTokens(file, "root")).inputTokens).toBe(7);
  });
});
