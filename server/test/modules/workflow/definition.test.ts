import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hookSettings, HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import {
  DEFAULT_WORKFLOW_DIR,
  loadWorkflow,
  parseWorkflowFiles,
  readWorkflowDir,
} from "../../../src/modules/workflow/definition.js";
import { cleanupTempDirs, makeRepo } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const where = { dir: "/wf", origin: "repo" as const };

/** A one-step workflow whose yml is `yml`, with a prompt file p.md that names its output. */
function parse(yml: string, extra: Record<string, string> = {}) {
  const files = new Map(Object.entries({ "workflow.yml": yml, "p.md": "{{previousRun}} Write {{outputs}}", ...extra }));
  return parseWorkflowFiles(files, where);
}

const ONE_STEP = "version: 2\nsteps:\n  - id: a\n    prompt: p.md\n    outputs: [{id: doc, file: doc.md}]\n    done-when: doc\n";

async function writeOverride(repo: string, files: Record<string, string>) {
  const dir = path.join(repo, ".claude", "taskpilot");
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
}

describe("workflow definition", () => {
  it("loads the built-in workflow with its outputs and prompts, without warnings", async () => {
    const def = await loadWorkflow(await makeRepo());
    expect(def).toMatchObject({ origin: "default", source: path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml") });
    expect(def.history).toMatchObject({ file: "00-history.md", entry: "## <YYYY-MM-DD HH:MM> · {{step}} · Claude", format: "format-history.md" });
    expect(def.steps.flatMap((s) => s.outputs.map((o) => o.format))).toEqual(["format-investigation.md", "format-plan.md", "format-progress.md", "format-summary.md"]);
    expect(def.restart).toEqual({ read: ["plan", "summary", "progress"] });
    expect(def.steps.map((s) => [s.id, s.gate, s.doneWhen?.file, s.outputs.map((o) => o.file)])).toEqual([
      ["investigate", "approve", "02-plan.md", ["01-investigation.md", "02-plan.md"]],
      ["implement", "approve", "04-summary.md", ["03-progress.md", "04-summary.md"]],
    ]);
    expect(def.steps[0].prompt).toContain("{{outputs}}");
    expect(def.steps[0].onReject).toContain("{{feedback}}");
    const { warnings } = parseWorkflowFiles(await readWorkflowDir(DEFAULT_WORKFLOW_DIR), { dir: DEFAULT_WORKFLOW_DIR, origin: "default" });
    expect(warnings).toEqual([]);
  });

  it("uses the repo's .claude/taskpilot/ override and ignores the old .claude/workflow.yml", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, ".claude", "workflow.yml"), "steps: []\n");
    await writeOverride(repo, { "workflow.yml": `permission-mode: acceptEdits\n${ONE_STEP}`, "p.md": "Custom {{key}}" });
    const def = await loadWorkflow(repo);
    expect(def).toMatchObject({ origin: "repo", permissionMode: "acceptEdits", dir: path.join(repo, ".claude", "taskpilot") });
    expect(def.steps[0]).toMatchObject({ id: "a", title: "a", gate: "none", prompt: "Custom {{key}}", doneWhen: { output: "doc", file: "doc.md" } });
  });

  it("never falls back to a built-in prompt the override does not have", async () => {
    const repo = await makeRepo();
    await writeOverride(repo, { "workflow.yml": "version: 2\nsteps:\n  - {id: a, prompt: implement.md}\n" });
    await expect(loadWorkflow(repo)).rejects.toThrow("file not found: implement.md");
  });

  it.each([
    ["steps: []", "version must be 2"],
    ["version: 2\nsteps: []", "non-empty"],
    ["version: 2\npermission-mode: bypassPermissions\nsteps:\n  - {id: a, prompt: p.md}", "permission-mode"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md}\n  - {id: a, prompt: p.md}", "duplicate step id"],
    ["version: 2\nsteps:\n  - {id: a, prompt: ../../etc/passwd}", "must be a file name like investigate.md"],
    ["version: 2\nsteps:\n  - {id: a, prompt: sub/p.md}", "must be a file name like investigate.md"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: x.md, format: nope.md}]}", "outputs[0].format: file not found: nope.md"],
    ["version: 2\nhistory: {format: ../h.md}\nsteps:\n  - {id: a, prompt: p.md}", "history.format must be a file name"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: x.md, format: f.md}]}", "f.md: {{feedback}} is only available"],
    ["version: 2\nsteps:\n  - {id: a, prompt: missing.md}", "not found"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, gate: maybe}", "gate"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, done-when: nope}", "done-when"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: ../x.md}]}", "file must be"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: spec/x.md}]}", "file must be"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: 00-history.md}]}", "already used"],
    ["version: 2\nsteps:\n  - {id: a, prompt: p.md, outputs: [{id: x, file: a.md}, {id: x, file: b.md}]}", "duplicate output id"],
    ["version: 2\nrestart: {read: [nope]}\nsteps:\n  - {id: a, prompt: p.md}", "restart.read"],
    ["version: 2\nrules: [1, 2]\nsteps:\n  - {id: a, prompt: p.md}", "rules"],
    ["version: 2\nsteps:\n  - {id: a, prompt: bad.md}", "{{out.missing}} names no output"],
    ["version: 2\nsteps:\n  - {id: a, prompt: fb.md}", "only available in on-reject"],
  ])("rejects %j", (yml, message) => {
    const { def, errors } = parse(yml, { "bad.md": "{{out.missing}}", "fb.md": "{{feedback}}", "f.md": "# {{feedback}}" });
    expect(def).toBeNull();
    expect(errors.join("\n")).toContain(message);
  });

  it("accepts {{feedback}} in on-reject prompts", () => {
    const { errors } = parse(`${ONE_STEP}    on-reject: r.md\n`, { "r.md": "{{feedback}} {{out.doc}}" });
    expect(errors).toEqual([]);
  });

  it("warns about unknown variables, unused files, unnamed outputs and a missing {{previousRun}}", () => {
    const { def, warnings } = parse(ONE_STEP, { "p.md": "Write {{specdir}}", "old.md": "" });
    expect(def).not.toBeNull();
    expect(warnings).toEqual([
      "p.md: unknown variable {{specdir}} is sent as it is",
      "p.md: step a has outputs but its prompt names none of them ({{outputs}} or {{out.<id>}})",
      "p.md: without {{previousRun}}, a restarted run is not told to read the archived documents",
      "old.md is not used by any step",
    ]);
  });

  it("runs every step with Claude unless the workflow or the step names another agent", async () => {
    const def = await loadWorkflow(await makeRepo());
    expect([def.agent, ...def.steps.map((s) => s.agent)]).toEqual(["claude", "claude", "claude"]);

    const two = "version: 2\nagent: copilot\nsteps:\n  - id: a\n    prompt: p.md\n    agent: claude\n  - id: b\n    prompt: p.md\n";
    const parsed = parse(two).def!;
    expect([parsed.agent, ...parsed.steps.map((s) => s.agent)]).toEqual(["copilot", "claude", "copilot"]);
  });

  it("rejects an unknown agent", () => {
    const { def, errors } = parse("version: 2\nagent: codex\nsteps:\n  - id: a\n    prompt: p.md\n    agent: gpt\n");
    expect(def).toBeNull();
    expect(errors).toEqual(["agent must be one of claude, copilot", "steps[0].agent must be one of claude, copilot"]);
  });

  it("injects every hook through curl with the session's env", () => {
    const settings = JSON.parse(hookSettings()) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });
});
