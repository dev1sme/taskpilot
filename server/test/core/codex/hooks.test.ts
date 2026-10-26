import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";
import { CODEX_HOOK_EVENTS, codexHookArgs, tomlValue } from "../../../src/core/codex/hooks.js";
import { CODEX_READY_MARKER, codexBackend, normalizeCodex } from "../../../src/modules/sessions/backends/codex.js";
import { HOOK_EVENTS, codexHookCommand, codexHookSettings, copilotHookCommand, isHookEvent, type HookEvent } from "../../../src/modules/sessions/hooks.js";
import type { HookState } from "../../../src/modules/sessions/backends/types.js";

const FIXTURES = path.resolve(import.meta.dirname, "../../fixtures/codex-tui");
/** Real hook payloads of Codex 0.163.0 (fixtures README). */
const fixture = (name: string) =>
  readFileSync(path.join(FIXTURES, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; payload: Record<string, unknown> });
const state = (): HookState => ({ openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() });

describe("tomlValue", () => {
  it.each(['say "hi"', "line one\nline two", "back\\slash", 'mix "\\"\n\ttab', "tiếng Việt 😀", "$HOME `x`", ""])("round-trips %j through TOML", (value) => {
    const text = tomlValue(value);
    expect(text).not.toContain("\n");
    expect(parseToml(`v = ${text}`).v).toBe(value);
  });

  it("writes booleans", () => {
    expect(tomlValue(false)).toBe("false");
    expect(tomlValue(true)).toBe("true");
  });
});

describe("codexHookArgs", () => {
  it("adds nothing without settings", () => {
    expect(codexHookArgs(undefined)).toEqual([]);
    expect(codexHookArgs("{}")).toEqual([]);
  });

  it("declares one -c entry per known event, in the nested schema of hooks.json", () => {
    const command = "curl -d \"$X\" || true; echo 'a\\b'";
    const args = codexHookArgs(JSON.stringify({ Stop: command, Unknown: "x", PreToolUse: 5 }));
    expect(args).toHaveLength(2);
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^hooks\.Stop=\[\{hooks=\[\{type="command",command=".*"\}\]\}\]$/);
    expect(parseToml(`hooks = ${args[1]!.slice("hooks.Stop=".length)}`)).toEqual({ hooks: [{ hooks: [{ type: "command", command }] }] });
  });
});

describe("codexHookSettings", () => {
  const settings = JSON.parse(codexHookSettings()) as Record<string, string>;

  it("holds a command for every Codex event, none for PostToolUseFailure", () => {
    expect(Object.keys(settings).sort()).toEqual([...CODEX_HOOK_EVENTS].sort());
    expect(settings.PostToolUseFailure).toBeUndefined();
  });

  it("posts each event to its route and Interrupt to Stop", () => {
    for (const event of CODEX_HOOK_EVENTS) {
      const route = event === "Interrupt" ? "Stop" : event;
      expect(isHookEvent(route), route).toBe(true);
      expect(settings[event]).toBe(codexHookCommand(route as HookEvent));
      expect(settings[event]).toContain(`"$TASKPILOT_HOOK_URL/${route}"`);
    }
  });

  it("does nothing in a Codex that TaskPilot did not start, and keeps Copilot's command as it was", () => {
    const env = { PATH: process.env.PATH ?? "", TASKPILOT_HOOK_URL: "http://127.0.0.1:1", TASKPILOT_HOOK_TOKEN: "t" };
    for (const guard of [{}, { TASKPILOT_HOOK_AGENT: "copilot" }]) {
      const res = spawnSync("sh", ["-c", `${settings.Stop}; echo ran-through`], { env: { ...env, ...guard }, encoding: "utf8", input: "{}" });
      expect(res.stdout).toBe(""); // `exit 0` before curl
      expect(res.status).toBe(0);
    }
    const ok = spawnSync("sh", ["-c", `${settings.Stop}; echo ran-through`], { env: { ...env, TASKPILOT_HOOK_AGENT: "codex" }, encoding: "utf8", input: "{}" });
    expect(ok.stdout).toBe("ran-through\n");
    expect(copilotHookCommand("Stop")).toContain('[ "$TASKPILOT_HOOK_AGENT" = copilot ]');
  });

  it("is the backend's launch settings, and PostToolUseFailure stays a hook route", () => {
    expect(codexBackend.launchSettings?.()).toBe(codexHookSettings());
    expect(HOOK_EVENTS).toContain("PostToolUseFailure");
  });
});

describe("CODEX_READY_MARKER", () => {
  it.each(["GPT-6-Luna low · /tmp/spike/repo", "GPT-6.1-Sol high · ~/dev/project", "GPT-6.1-Sol default·~/dev/project"])("matches the footer %j", (footer) => {
    expect(CODEX_READY_MARKER.test(`› Ask Codex to do anything\n${footer}`)).toBe(true);
  });

  it.each([
    "Waiting for startup · esc cancel",
    "Update available · 0.163.0 → 0.164.0",
    "Hooks need review 1 hook is new or changed. enter confirm · esc skip",
    "Working directory · resume Session = latest cwd",
    "Ask Codex to do anything",
    "Starting MCP servers (1/2): codex_apps (0s • esc to interrupt)",
  ])("does not match the screen %j, which blocks the input", (screen) => {
    expect(CODEX_READY_MARKER.test(screen)).toBe(false);
  });

  it("is what the backend waits for", () => {
    expect(codexBackend.readyMarker).toBe(CODEX_READY_MARKER);
  });
});

describe("nativeIdOf", () => {
  it("is the thread id in every hook payload of a real turn, also after a resume", () => {
    for (const name of ["hooks-turn-approval.jsonl", "hooks-resume.jsonl"]) {
      for (const { payload } of fixture(name).filter((e) => e.event !== "SessionEnd")) expect(codexBackend.nativeIdOf?.(payload), name).toBe(payload.session_id);
    }
    expect(codexBackend.nativeIdOf?.({})).toBeUndefined();
    expect(codexBackend.nativeIdOf?.({ session_id: "" })).toBeUndefined();
  });
});

describe("normalizeCodex", () => {
  const turn = fixture("hooks-turn-approval.jsonl");
  const edit = fixture("hooks-edit-fail-interrupt-quit.jsonl");

  it("drops SessionStart, which Codex fires only with the first prompt", async () => {
    for (const { event, payload } of [...turn, ...fixture("hooks-resume.jsonl")].filter((e) => e.event === "SessionStart")) {
      expect(await normalizeCodex(event as HookEvent, payload, state())).toBeNull();
    }
  });

  it("keeps the Claude-shaped events as Codex sent them, tool_use_id and last message included", async () => {
    for (const { event, payload } of turn.filter((e) => e.event !== "SessionStart")) {
      expect(await normalizeCodex(event as HookEvent, payload, state()), event).toEqual(payload);
    }
    const stop = turn.find((e) => e.event === "Stop")!;
    expect(stop.payload.last_assistant_message).toBe("SPIKE-DONE");
    const pre = turn.find((e) => e.event === "PreToolUse")!;
    expect(typeof pre.payload.tool_use_id).toBe("string");
  });

  it("leaves PermissionRequest without a tool_use_id", async () => {
    const request = turn.find((e) => e.event === "PermissionRequest")!;
    const out = await normalizeCodex("PermissionRequest", request.payload, state());
    expect(out).toMatchObject({ tool_name: "Bash" });
    expect(out).not.toHaveProperty("tool_use_id");
  });

  it("names apply_patch Edit and finds the patched file", async () => {
    const pre = edit.find((e) => e.event === "PreToolUse" && e.payload.tool_name === "apply_patch")!;
    const out = (await normalizeCodex("PreToolUse", pre.payload, state()))!;
    expect(out.tool_name).toBe("Edit");
    const patch = (pre.payload.tool_input as { command: string }).command;
    const file = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch)?.[1];
    expect(file).toBeTruthy();
    expect(out.tool_input).toMatchObject({ command: patch, file_path: file });
    const post = edit.find((e) => e.event === "PostToolUse" && e.payload.tool_name === "apply_patch")!;
    expect((await normalizeCodex("PostToolUse", post.payload, state()))?.tool_name).toBe("Edit");
    expect(out.tool_use_id).toBe(pre.payload.tool_use_id);
  });

  it("does not touch the tool input when the patch names no file or the input already has one", async () => {
    const base = { tool_name: "apply_patch", tool_use_id: "exec-1" };
    expect((await normalizeCodex("PreToolUse", { ...base, tool_input: { command: "garbage" } }, state()))?.tool_input).toEqual({ command: "garbage" });
    const given = { command: "*** Begin Patch\n*** Add File: a.txt\n", file_path: "kept.txt" };
    expect((await normalizeCodex("PreToolUse", { ...base, tool_input: given }, state()))?.tool_input).toEqual(given);
    expect((await normalizeCodex("PreToolUse", { ...base, tool_input: "text" }, state()))?.tool_name).toBe("Edit");
  });

  it("ends the turn on Interrupt, which Codex fires instead of Stop when Esc is pressed", async () => {
    const interrupt = edit.find((e) => e.event === "Interrupt")!;
    expect(interrupt.payload.hook_event_name).toBe("Interrupt");
    // codexHookSettings posts it to /Stop.
    const out = await normalizeCodex("Stop", interrupt.payload, state());
    expect(out).toMatchObject({ session_id: interrupt.payload.session_id, interrupted: true });
    expect(out).not.toHaveProperty("last_assistant_message");
    const stop = turn.find((e) => e.event === "Stop")!;
    expect(await normalizeCodex("Stop", stop.payload, state())).not.toHaveProperty("interrupted");
  });

  it("does not change the payload it was given", async () => {
    const pre = edit.find((e) => e.event === "PreToolUse" && e.payload.tool_name === "apply_patch")!;
    const before = JSON.stringify(pre.payload);
    await normalizeCodex("PreToolUse", pre.payload, state());
    expect(JSON.stringify(pre.payload)).toBe(before);
  });
});
