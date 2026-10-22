import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AGENTS } from "../../../src/core/agents.js";
import { AGENTS as CLIENT_AGENTS } from "../../../../client/src/shared/agents.js";
import { HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import { BACKENDS, type HookState } from "../../../src/modules/sessions/backends/index.js";
import {
  COPILOT_SETTINGS,
  copilotHooksFile,
  ensureCopilotHooks,
  lastAssistantMessage,
  normalizeCopilot,
  stripComments,
  userHooksText,
  withoutTaskPilotHooks,
} from "../../../src/modules/sessions/backends/copilot.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const state = (): HookState => ({ openTools: new Map(), nextToolId: 1, finishedAt: new Map(), heldPermissions: new Map() });
const SID = "5c462bd1-30c6-4a29-9ff8-0280f70857af";

describe("backends", () => {
  it("has one backend per agent", () => {
    expect(CLIENT_AGENTS).toEqual(AGENTS);
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
    await writeFile(
      transcript,
      [line("user.message", "hi"), line("assistant.message", "Plan.\n\n1. Q? — Đề xuất: có"), line("assistant.message", ""), line("assistant.turn_end", "")].join("\n"),
    );
    const stop = { session_id: SID, transcript_path: transcript, stop_reason: "end_turn" };
    expect(await normalizeCopilot("Stop", stop, state())).toMatchObject({ last_assistant_message: "Plan.\n\n1. Q? — Đề xuất: có" });
    expect(await lastAssistantMessage(path.join(dir, "missing.jsonl"))).toBeNull();
  });

  it("waits for the stopped turn to reach the transcript, which copilot writes after the Stop hook", async () => {
    const dir = await tempDir("taskpilot-copilot-");
    const transcript = path.join(dir, "events.jsonl");
    const at = (ms: number) => new Date(ms).toISOString();
    const stoppedAt = Date.now();
    const event = (type: string, ms: number, content = "") => JSON.stringify({ type, timestamp: at(ms), data: { content } });
    await writeFile(transcript, `${event("assistant.message", stoppedAt - 9000, "Lượt trước.")}\n${event("assistant.turn_end", stoppedAt - 8900)}\n`);
    setTimeout(() => void appendFile(transcript, `${event("assistant.message", stoppedAt - 5, "Lượt này.")}\n${event("assistant.turn_end", stoppedAt - 3)}\n`), 300);
    const stop = { session_id: SID, transcript_path: transcript, timestamp: at(stoppedAt) };
    expect(await normalizeCopilot("Stop", stop, state())).toMatchObject({ last_assistant_message: "Lượt này." });
  });
});

describe("copilot hook file", () => {
  it("holds every hook in Copilot's flat schema with a guard for sessions TaskPilot did not start", () => {
    const data = JSON.parse(userHooksText()) as { version: number; hooks: Record<string, Array<Record<string, unknown>>> };
    expect(data.version).toBe(1);
    expect(Object.keys(data.hooks)).toEqual([...HOOK_EVENTS]);
    const stop = data.hooks.Stop[0];
    expect(stop).toMatchObject({ type: "command", timeoutSec: 10 });
    expect(stop.bash).toMatch(/^\[ "\$TASKPILOT_HOOK_AGENT" = copilot \] && \[ -n "\$TASKPILOT_HOOK_TOKEN" \] \|\| exit 0; curl /);
    expect(stop.bash).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });

  it("does nothing in a Copilot that TaskPilot did not start", () => {
    const stop = (JSON.parse(userHooksText()) as { hooks: { Stop: Array<{ bash: string }> } }).hooks.Stop[0].bash;
    const run = (env: Record<string, string>) =>
      spawnSync("sh", ["-c", stop.replace("curl ", "echo curl-ran #")], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" }).stdout;
    expect(run({})).toBe("");
    expect(run({ TASKPILOT_HOOK_TOKEN: "t" })).toBe("");
    expect(run({ TASKPILOT_HOOK_AGENT: "copilot" })).toBe("");
    expect(run({ TASKPILOT_HOOK_AGENT: "copilot", TASKPILOT_HOOK_TOKEN: "t" })).toContain("curl-ran");
  });

  it("removes only TaskPilot's entries from a settings file and reads JSONC", () => {
    const own = { type: "command", bash: "curl $TASKPILOT_HOOK_URL/Stop" };
    const user = `{
  // personal overrides
  "model": "gpt-5", /* inline */
  "url": "https://example.com//not-a-comment",
  "hooks": { "Stop": [{ "type": "command", "bash": "echo mine" }, ${JSON.stringify(own)}], "PreToolUse": [${JSON.stringify(own)}], "sessionEnd": [{ "bash": "echo bye" }] }
}`;
    const data = JSON.parse(withoutTaskPilotHooks(user) as string) as { model: string; url: string; hooks: Record<string, Array<{ bash: string }>> };
    expect(data.model).toBe("gpt-5");
    expect(data.url).toBe("https://example.com//not-a-comment");
    expect(data.hooks).toEqual({ Stop: [{ type: "command", bash: "echo mine" }], sessionEnd: [{ bash: "echo bye" }] });
    const clean = JSON.stringify({ hooks: { Stop: [{ bash: "echo mine" }] } });
    expect(withoutTaskPilotHooks(clean)).toBe(clean);
  });

  it("strips comments but not comment-like text in strings", () => {
    expect(JSON.parse(stripComments('{"a": "x // y", // c\n "b": "/* z */" /* d */}'))).toEqual({ a: "x // y", b: "/* z */" });
  });

  describe("on disk", () => {
    const saved = process.env.COPILOT_HOME;
    afterEach(() => {
      if (saved === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = saved;
    });

    it("writes hooks/taskpilot.json under COPILOT_HOME once, and leaves the repo alone", async () => {
      const home = await tempDir("taskpilot-copilot-home-");
      process.env.COPILOT_HOME = home;
      const repo = await tempDir("taskpilot-copilot-repo-");
      await mkdir(path.join(repo, ".git", "info"), { recursive: true });
      await ensureCopilotHooks(repo);
      const file = path.join(home, "hooks", "taskpilot.json");
      expect(copilotHooksFile()).toBe(file);
      const first = await stat(file);
      await Promise.all([ensureCopilotHooks(repo), ensureCopilotHooks(repo)]);
      expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);
      expect(JSON.parse(await readFile(file, "utf8")).hooks.Stop).toHaveLength(1);
      expect(await readdir(path.join(repo, ".git", "info"))).toEqual([]);
      expect((await readdir(repo)).sort()).toEqual([".git"]);
    });

    it("drops the entries older versions put into the repo, keeping the user's own data", async () => {
      process.env.COPILOT_HOME = await tempDir("taskpilot-copilot-home-");
      const own = { type: "command", bash: "curl $TASKPILOT_HOOK_URL/Stop" };
      const only = await tempDir("taskpilot-copilot-repo-");
      const mixed = await tempDir("taskpilot-copilot-repo-");
      for (const [repo, settings] of [
        [only, { hooks: { Stop: [own] } }],
        [mixed, { model: "gpt-5", hooks: { Stop: [own, { bash: "echo mine" }] } }],
      ] as const) {
        await mkdir(path.join(repo, ".github", "copilot"), { recursive: true });
        await writeFile(path.join(repo, COPILOT_SETTINGS), JSON.stringify(settings));
        await ensureCopilotHooks(repo);
      }
      await expect(stat(path.join(only, COPILOT_SETTINGS))).rejects.toThrow();
      expect(JSON.parse(await readFile(path.join(mixed, COPILOT_SETTINGS), "utf8"))).toEqual({ model: "gpt-5", hooks: { Stop: [{ bash: "echo mine" }] } });
    });
  });
});
