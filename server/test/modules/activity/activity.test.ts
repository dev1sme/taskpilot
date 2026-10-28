import { afterAll, describe, expect, it } from "vitest";
import { t } from "../../../src/core/i18n.js";
import { describeTool } from "../../../src/modules/activity/describe.js";
import { ActivityStore } from "../../../src/modules/activity/store.js";
import { sessionEventFromHook, type HookEvent } from "../../../src/modules/sessions/index.js";
import type { SessionMeta } from "../../../src/core/state.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const meta: SessionMeta = {
  id: "00000000-0000-4000-8000-000000000001",
  repo: "/repo",
  taskKey: "DEMO-1",
  title: "Session 1",
  createdAt: 0,
};

const hook = (event: HookEvent, payload: Record<string, unknown>) => sessionEventFromHook({ sessionId: meta.id, provider: "claude" }, event, payload);

describe("describeTool", () => {
  it.each([
    ["Read", { file_path: "/repo/src/a.ts" }, "read", "Đọc src/a.ts"],
    ["Write", { file_path: "/repo/.claude/tasks/DEMO-1/02-plan.md" }, "write", "Ghi .claude/tasks/DEMO-1/02-plan.md"],
    ["Edit", { file_path: "/elsewhere/x.ts" }, "write", "Sửa /elsewhere/x.ts"],
    ["Bash", { command: "npm test", description: "Run tests" }, "run", "Chạy npm test"],
    ["Grep", { pattern: "x", path: "/repo" }, "search", 'Tìm "x"'],
    ["Grep", { pattern: "toCsv", path: "/repo/src" }, "search", 'Tìm "toCsv" trong src'],
    ["mcp__github__create_issue", {}, "other", "Dùng github › create_issue"],
  ])("%s", (tool, input, category, summary) => {
    expect(describeTool(tool, input, "/repo")).toMatchObject({ category, summary });
  });
});

describe("ActivityStore", () => {
  it("pairs tool calls by tool_use_id, records failures and survives a reload", async () => {
    const dir = await tempDir("taskpilot-activity-");
    const store = new ActivityStore(dir);
    const seen: string[] = [];
    store.on("item", (i) => seen.push(`${i.kind}:${i.status ?? ""}`));

    await store.record(meta, hook("SessionStart", { source: "startup" }));
    await store.record(meta, hook("UserPromptSubmit", { prompt: "Investigate DEMO-1\nmore lines" }));
    await store.record(meta, hook("PreToolUse", { tool_name: "Read", tool_use_id: "t1", tool_input: { file_path: "/repo/a.md" } }));
    await store.record(meta, hook("PostToolUse", { tool_name: "Read", tool_use_id: "t1", duration_ms: 12 }));
    await store.record(meta, hook("PreToolUse", { tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "ls nope" } }));
    await store.record(meta, hook("PostToolUseFailure", { tool_name: "Bash", tool_use_id: "t2", error: "Exit code 2", duration_ms: 30 }));
    await store.record(meta, hook("Stop", { last_assistant_message: "Plan written.\nDetails…" }));

    const items = await store.list([meta.id]);
    expect(items.map((i) => [i.kind, i.summary, i.status])).toEqual([
      ["session", "Session bắt đầu", undefined],
      ["prompt", "Nhận yêu cầu: Investigate DEMO-1", undefined],
      ["tool", "Đọc a.md", "done"],
      ["tool", "Chạy ls nope", "error"],
      ["stop", "Plan written.", undefined],
    ]);
    expect(items[2].durationMs).toBe(12);
    expect(items[3].detail).toBe("Exit code 2");
    expect(seen).toContain("tool:running");

    const reloaded = await new ActivityStore(dir).list([meta.id]);
    expect(reloaded).toEqual(items);
  });

  it("preserves resume and transcript summaries through neutral events", async () => {
    const store = new ActivityStore(await tempDir("taskpilot-activity-"));
    await store.record(meta, { sessionId: meta.id, provider: "codex", type: "session.started", resumed: true });
    await store.record(meta, { sessionId: meta.id, provider: "codex", type: "turn.interrupted", source: "transcript", message: "partial answer" });
    const items = await store.list([meta.id]);
    expect(items).toHaveLength(2);
    expect(items[0].summary).toBe(t("activity.sessionResume"));
    expect(items[1]).toMatchObject({ kind: "stop", detail: "partial answer" });
  });

  it("keeps what a permission request asks for apart from its prefix", async () => {
    const store = new ActivityStore(await tempDir("taskpilot-activity-"));
    await store.record(meta, hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "npm test" } }));

    const [item] = await store.list([meta.id]);
    expect(item).toMatchObject({ kind: "permission", summary: "Xin quyền: Chạy npm test", action: "Chạy npm test" });
  });
});
