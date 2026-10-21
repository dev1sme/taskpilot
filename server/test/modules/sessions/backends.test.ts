import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AGENTS } from "../../../src/core/agents.js";
import { HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import { BACKENDS, type HookState } from "../../../src/modules/sessions/backends/index.js";
import {
  COPILOT_SETTINGS,
  ensureCopilotHooks,
  lastAssistantMessage,
  normalizeCopilot,
  stripComments,
  withTaskPilotHooks,
} from "../../../src/modules/sessions/backends/copilot.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const state = (): HookState => ({ openTools: new Map(), nextToolId: 1 });
const SID = "5c462bd1-30c6-4a29-9ff8-0280f70857af";

describe("backends", () => {
  it("has one backend per agent", () => {
    expect(Object.keys(BACKENDS).sort()).toEqual([...AGENTS].sort());
    for (const agent of AGENTS) expect(BACKENDS[agent].id).toBe(agent);
  });
});

// Payloads as copilot 1.0.100 sent them in an interactive session (spike, TPL-009).
describe("normalizeCopilot", () => {
  it("drops SessionStart, which copilot fires only with the first prompt", async () => {
    expect(await normalizeCopilot("SessionStart", { hook_event_name: "SessionStart", session_id: SID, source: "new" }, state())).toBeNull();
  });

  it("pairs tool calls without tool_use_id, oldest first per tool", async () => {
    const s = state();
    const pre = (tool: string, input: unknown) => normalizeCopilot("PreToolUse", { session_id: SID, tool_name: tool, tool_input: input }, s);
    const post = (tool: string) => normalizeCopilot("PostToolUse", { session_id: SID, tool_name: tool, tool_result: { result_type: "success" } }, s);
    expect(await pre("Bash", { command: "ls nope" })).toMatchObject({ tool_use_id: "copilot-1", tool_input: { command: "ls nope" } });
    expect(await pre("Read", { path: "/r/README.md" })).toMatchObject({ tool_use_id: "copilot-2" });
    expect(await pre("Bash", { command: "pwd" })).toMatchObject({ tool_use_id: "copilot-3" });
    expect(await post("Read")).toMatchObject({ tool_use_id: "copilot-2" });
    expect(await post("Bash")).toMatchObject({ tool_use_id: "copilot-1" });
    expect(await post("Bash")).toMatchObject({ tool_use_id: "copilot-3" });
    expect((await post("Bash"))?.tool_use_id).toBeUndefined();
    expect(s.openTools.size).toBe(0);
  });

  it("turns the camelCase PermissionRequest into Claude's fields and tool names", async () => {
    const payload = { hookName: "permissionRequest", sessionId: SID, toolName: "bash", toolInput: { command: "ls" }, permissionSuggestions: [] };
    expect(await normalizeCopilot("PermissionRequest", payload, state())).toMatchObject({
      session_id: SID,
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
  });

  it("adds the last assistant message of the turn to Stop from the transcript", async () => {
    const dir = await tempDir("taskpilot-copilot-");
    const transcript = path.join(dir, "events.jsonl");
    const line = (type: string, content: string) => JSON.stringify({ type, data: { content } });
    await writeFile(transcript, [line("user.message", "hi"), line("assistant.message", "Plan.\n\n1. Q? — Đề xuất: có"), line("assistant.message", ""), line("assistant.turn_end", "")].join("\n"));
    const stop = { session_id: SID, transcript_path: transcript, stop_reason: "end_turn" };
    expect(await normalizeCopilot("Stop", stop, state())).toMatchObject({ last_assistant_message: "Plan.\n\n1. Q? — Đề xuất: có" });
    expect(await lastAssistantMessage(path.join(dir, "missing.jsonl"))).toBeNull();
  });
});

describe("copilot hook file", () => {
  it("adds every hook in Copilot's flat schema with a guard for sessions TaskPilot did not start", () => {
    const data = JSON.parse(withTaskPilotHooks(null)) as { hooks: Record<string, Array<Record<string, unknown>>> };
    expect(Object.keys(data.hooks)).toEqual([...HOOK_EVENTS]);
    const stop = data.hooks.Stop[0];
    expect(stop).toMatchObject({ type: "command", timeoutSec: 10 });
    expect(stop.bash).toMatch(/^\[ -n "\$TASKPILOT_HOOK_TOKEN" \] \|\| exit 0; curl /);
    expect(stop.bash).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });

  it("keeps the user's keys and hooks, replaces only its own, and reads JSONC", () => {
    const user = `{
  // personal overrides
  "model": "gpt-5", /* inline */
  "url": "https://example.com//not-a-comment",
  "hooks": { "Stop": [{ "type": "command", "bash": "echo mine" }], "sessionEnd": [{ "bash": "echo bye" }] }
}`;
    const once = withTaskPilotHooks(user);
    const data = JSON.parse(once) as { model: string; url: string; hooks: Record<string, Array<{ bash: string }>> };
    expect(data.model).toBe("gpt-5");
    expect(data.url).toBe("https://example.com//not-a-comment");
    expect(data.hooks.sessionEnd).toEqual([{ bash: "echo bye" }]);
    expect(data.hooks.Stop.map((h) => h.bash.includes("TASKPILOT_HOOK_URL"))).toEqual([false, true]);
    expect(withTaskPilotHooks(once)).toBe(once);
  });

  it("strips comments but not comment-like text in strings", () => {
    expect(JSON.parse(stripComments('{"a": "x // y", // c\n "b": "/* z */" /* d */}'))).toEqual({ a: "x // y", b: "/* z */" });
  });

  it("writes the file once and never touches .gitignore or .git/info/exclude", async () => {
    const repo = await tempDir("taskpilot-copilot-repo-");
    await mkdir(path.join(repo, ".git", "info"), { recursive: true });
    await ensureCopilotHooks(repo);
    const file = path.join(repo, COPILOT_SETTINGS);
    const first = await stat(file);
    await Promise.all([ensureCopilotHooks(repo), ensureCopilotHooks(repo)]);
    expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);
    expect(JSON.parse(await readFile(file, "utf8")).hooks.Stop).toHaveLength(1);
    expect(await readdir(path.join(repo, ".git", "info"))).toEqual([]);
    expect((await readdir(repo)).sort()).toEqual([".git", ".github"]);
  });
});
