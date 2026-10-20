import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hookSettings, HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import { loadWorkflow, parseWorkflow, render, DEFAULT_WORKFLOW_DIR } from "../../../src/modules/workflow/definition.js";
import { cleanupTempDirs, makeRepo, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

describe("workflow definition", () => {
  it("loads the built-in workflow with its prompts", async () => {
    const def = await loadWorkflow(await makeRepo());
    expect(def.source).toBe(path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml"));
    expect(def.steps.map((s) => [s.id, s.gate, s.doneWhen?.file])).toEqual([
      ["investigate", "approve", "02-plan.md"],
      ["implement", "approve", "04-summary.md"],
    ]);
    expect(def.steps[0].prompt).toContain("{{specDir}}");
    expect(def.steps[0].onReject).toContain("{{feedback}}");
  });

  it("prefers .claude/workflow.yml and falls back to default prompts", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, ".claude", "custom.md"), "Custom {{key}}");
    await writeFile(
      path.join(repo, ".claude", "workflow.yml"),
      "permission-mode: acceptEdits\nsteps:\n  - id: one\n    prompt: custom.md\n  - id: two\n    prompt: implement.md\n",
    );
    const def = await loadWorkflow(repo);
    expect(def.permissionMode).toBe("acceptEdits");
    expect(def.steps[0]).toMatchObject({ id: "one", title: "one", gate: "none", prompt: "Custom {{key}}" });
    expect(def.steps[1].prompt).toContain("approved");
  });

  it.each([
    ["steps: []", "non-empty"],
    ["permission-mode: bypassPermissions\nsteps:\n  - {id: a, prompt: implement.md}", "permission-mode"],
    ["steps:\n  - {id: a, prompt: implement.md}\n  - {id: a, prompt: implement.md}", "duplicate"],
    ["steps:\n  - {id: a, prompt: ../../etc/passwd}", "relative"],
    ["steps:\n  - {id: a, prompt: missing.md}", "not found"],
    ["steps:\n  - {id: a, prompt: implement.md, gate: maybe}", "gate"],
  ])("rejects %j", async (yaml, message) => {
    const dir = await tempDir("taskpilot-wf-");
    await writeFile(path.join(dir, "workflow.yml"), yaml);
    await expect(parseWorkflow(path.join(dir, "workflow.yml"), [dir, DEFAULT_WORKFLOW_DIR])).rejects.toThrow(message);
  });

  it("renders known variables and leaves unknown ones visible", () => {
    expect(render("{{key}} {{nope}}", { key: "A-1" })).toBe("A-1 {{nope}}");
  });

  it("injects every hook through curl with the session's env", () => {
    const settings = JSON.parse(hookSettings()) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });
});
