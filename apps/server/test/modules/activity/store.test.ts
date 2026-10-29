import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ActivityStore } from "../../../src/modules/activity/store.js";
it("persists a template tool as a tool, never a fabricated native child", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tpl039-activity-"));
  try {
    const store = new ActivityStore(dir);
    const meta = { id: "s", repo: dir, taskKey: "DEMO-1", title: "Template", createdAt: 1, agent: "codex" as const, subagent: "template" };
    await store.record(meta, { sessionId: "s", provider: "codex", type: "tool.started", tool: { callId: "tool1", name: "Agent", input: { description: "template" } } });
    await store.record(meta, { sessionId: "s", provider: "codex", type: "tool.completed", tool: { callId: "tool1" } });
    const items = await new ActivityStore(dir).list(["s"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "tool", status: "done" });
    expect(items[0]).not.toHaveProperty("childId");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
