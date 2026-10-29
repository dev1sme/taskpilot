import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acceptCodexHook, codexHookKey, codexObservation } from "../../../src/providers/codex/observation.js";
import { codexTurnMetrics, normalizeCodex } from "../../../src/modules/sessions/backends/codex.js";
import { codexHookSettings, hookSettings } from "../../../src/modules/sessions/hooks.js";
import { CODEX_HOOK_EVENTS } from "../../../src/providers/codex/hooks.js";
import { codexLauncher } from "../../../src/providers/codex/cli-launcher.js";
let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("keeps unverified lifecycle disabled and preserves provider hook configuration", () => {
  expect(codexObservation(null).hooks).toEqual({ state: "missing", reason: "no-hook" });
  expect(codexObservation(12).hooks).toEqual({ state: "available", checkedAt: 12 });
  expect(codexObservation(12).childLifecycle.state).toBe("unverified");
  expect(Object.keys(JSON.parse(codexHookSettings()))).toEqual([...CODEX_HOOK_EVENTS]);
  expect(Object.keys(JSON.parse(hookSettings()).hooks)).not.toContain("SubagentStart");
  const launch = codexLauncher("session", { resume: false, model: "gpt-6.1-sol", permissionMode: "acceptEdits", settings: codexHookSettings() });
  expect(launch.args).toEqual(expect.arrayContaining(["-m", "gpt-6.1-sol", "-s", "workspace-write", "-a", "on-request"]));
  expect(launch.args.join(" ")).not.toContain("bypass");
});
it("binds only a CLI root rollout; child-before-root and missing identity are rejected", async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tpl039-identity-"));
  const file = path.join(dir, "rollout.jsonl");
  const raw = { session_id: "root", hook_event_name: "SessionStart", source: "startup", transcript_path: file };
  expect(await acceptCodexHook("SessionStart", raw, { repo: dir })).toBe(false);
  await writeFile(file, JSON.stringify({ type: "session_meta", payload: { id: "root", source: { subagent: "child" }, cwd: dir } }) + "\n");
  expect(await acceptCodexHook("SessionStart", raw, { repo: dir })).toBe(false);
  await writeFile(file, JSON.stringify({ type: "session_meta", payload: { id: "root", source: "cli", cwd: dir } }) + "\n");
  expect(await acceptCodexHook("SessionStart", raw, { repo: dir })).toBe(true);
  expect(await acceptCodexHook("UserPromptSubmit", { ...raw, hook_event_name: "UserPromptSubmit" }, { repo: dir })).toBe(true);
  expect(await acceptCodexHook("SessionStart", raw, { repo: "/wrong" })).toBe(false);
  expect(await acceptCodexHook("Stop", { session_id: "child", hook_event_name: "Stop" }, { repo: dir, nativeId: "root" })).toBe(false);
  expect(await acceptCodexHook("Stop", { session_id: "root", hook_event_name: "Stop" }, { repo: dir, nativeId: "root" })).toBe(true);
});
it("preserves Interrupt mapping and never reads a missing rollout as zero", async () => {
  const interrupted = await normalizeCodex("Stop", { hook_event_name: "Interrupt" }, {} as never);
  expect(interrupted).toEqual({ hook_event_name: "Interrupt", interrupted: true });
  expect(await codexTurnMetrics("Stop", interrupted!, { nativeId: "root" })).toBeNull();
  expect(await codexTurnMetrics("Stop", {}, { nativeId: "root" })).toMatchObject({ source: "codex-thread", availability: { state: "missing", reason: "no-source" } });
});
it("dedupes only events with sufficient native turn/call identity", () => {
  const raw = { session_id: "root", turn_id: "t1", hook_event_name: "Stop" };
  expect(codexHookKey("Stop", raw)).toBe(codexHookKey("Stop", { ...raw }));
  expect(codexHookKey("Stop", { ...raw, turn_id: "t2" })).not.toBe(codexHookKey("Stop", raw));
  expect(codexHookKey("PostToolUse", raw)).toBeUndefined();
});
it("suppresses out-of-order native turn callbacks without treating Interrupt as completed", async () => {
  const state = {} as never;
  await normalizeCodex("UserPromptSubmit", { turn_id: "old" }, state);
  await normalizeCodex("UserPromptSubmit", { turn_id: "current" }, state);
  expect(await normalizeCodex("Stop", { turn_id: "old" }, state)).toBeNull();
  expect(await normalizeCodex("UserPromptSubmit", { turn_id: "old" }, state)).toBeNull();
  expect(await normalizeCodex("Stop", { turn_id: "current", hook_event_name: "Interrupt" }, state)).toMatchObject({ interrupted: true });
  expect(await normalizeCodex("PostToolUse", { turn_id: "current" }, state)).toBeNull();
});
