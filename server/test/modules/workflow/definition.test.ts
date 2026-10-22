import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hookSettings, HOOK_EVENTS } from "../../../src/modules/sessions/hooks.js";
import { DEFAULT_WORKFLOW_DIR, loadWorkflow, parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { readRepoSettings } from "../../../src/modules/workflow/settings.js";
import { cleanupTempDirs, makeRepo } from "../../helpers/fixtures.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";

const LEADER_WORKFLOW_DIR = modeDir("leader");

afterAll(cleanupTempDirs);

const where = { dir: "/wf", origin: "repo" as const };

/** A one-step workflow whose yml is `yml`, with a prompt file p.md that names its output. */
function parse(yml: string, extra: Record<string, string> = {}) {
  const files = new Map(Object.entries({ "workflow.yml": yml, "p.md": "{{previousRun}} Write {{outputs}}", ...extra }));
  return parseWorkflowFiles(files, where);
}

const ONE_STEP = "version: 2\nsteps:\n  - id: a\n    prompt: p.md\n    outputs: [{id: doc, file: doc.md}]\n    done-when: doc\n";

async function writeOverride(repo: string, files: Record<string, string>) {
  const dir = path.join(repo, ".taskpilot");
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
}

describe("workflow definition", () => {
  it("loads the built-in workflow with its outputs and prompts, without warnings", async () => {
    const def = await loadWorkflow(await makeRepo());
    expect(def).toMatchObject({ origin: "default", source: path.join(DEFAULT_WORKFLOW_DIR, "workflow.yml") });
    expect(def.history).toMatchObject({ file: "00-history.md", entry: "## <YYYY-MM-DD HH:MM> · {{step}} · {{agent}}", format: "format-history.md" });
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

  it("uses the repo's .taskpilot/ override and ignores the old .claude/workflow.yml", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, ".claude", "workflow.yml"), "steps: []\n");
    await writeOverride(repo, { "workflow.yml": `permission-mode: acceptEdits\n${ONE_STEP}`, "p.md": "Custom {{key}}" });
    const def = await loadWorkflow(repo);
    expect(def).toMatchObject({ origin: "repo", permissionMode: "acceptEdits", dir: path.join(repo, ".taskpilot") });
    expect(def.steps[0]).toMatchObject({ id: "a", title: "a", gate: "none", prompt: "Custom {{key}}", doneWhen: { output: "doc", file: "doc.md" } });
  });

  it("does not take settings.yml for a workflow file, and reads its mode", async () => {
    const repo = await makeRepo();
    expect(await readRepoSettings(repo)).toEqual({});
    await writeOverride(repo, { "settings.yml": "mode: leader\n" });
    expect((await readWorkflowDir(path.join(repo, ".taskpilot"))).size).toBe(0);
    expect(await readRepoSettings(repo)).toEqual({ mode: "leader" });
    await writeOverride(repo, { "settings.yml": "mode: [broken\n" });
    expect(await readRepoSettings(repo)).toEqual({});
    await writeOverride(repo, { "settings.yml": "mode: 3\n" });
    expect(await readRepoSettings(repo)).toEqual({});
  });

  describe("modes", () => {
    const extendsLeader = "extends: leader\nsteps:\n  - id: investigate\n    title: Mine\n";

    it("is the default mode with no override and the leader mode when asked or selected, no override needed", async () => {
      const repo = await makeRepo();
      expect((await loadWorkflow(repo)).mode).toMatchObject({ id: "default", override: false });
      expect((await loadWorkflow(repo, "leader")).steps.some((s) => s.dispatch)).toBe(true);
      expect((await loadWorkflow(repo, undefined, "leader")).mode).toMatchObject({ id: "leader", override: false });
      expect((await loadWorkflow(repo, undefined, "nope")).mode?.id).toBe("default");
    });

    it("rejects an unknown explicit mode with 400", async () => {
      await expect(loadWorkflow(await makeRepo(), "nope")).rejects.toMatchObject({ status: 400 });
      await expect(loadWorkflow(await makeRepo(), "custom")).rejects.toMatchObject({ status: 400 });
    });

    it("takes a legacy override as the mode custom", async () => {
      const repo = await makeRepo();
      await writeOverride(repo, { "workflow.yml": ONE_STEP, "p.md": "x" });
      expect((await loadWorkflow(repo)).mode).toMatchObject({ id: "custom", override: true });
      expect((await loadWorkflow(repo, "default")).mode).toMatchObject({ id: "default", override: false });
    });

    it("applies an `extends` override to its own mode only", async () => {
      const repo = await makeRepo();
      await writeOverride(repo, { "workflow.yml": extendsLeader });
      const own = await loadWorkflow(repo);
      expect(own.mode).toMatchObject({ id: "leader", override: true });
      expect(own.steps[0].title).toBe("Mine");
      const other = await loadWorkflow(repo, "default");
      expect(other.mode).toMatchObject({ id: "default", override: false });
      expect(other.steps[0].title).not.toBe("Mine");
      expect((await loadWorkflow(repo, undefined, "default")).mode?.id).toBe("default");
    });
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
    // The built-in workflow plans with Claude and implements with Copilot.
    const def = await loadWorkflow(await makeRepo());
    expect([def.agent, ...def.steps.map((s) => s.agent)]).toEqual(["claude", "claude", "copilot"]);

    const two = "version: 2\nagent: copilot\nsteps:\n  - id: a\n    prompt: p.md\n    agent: claude\n  - id: b\n    prompt: p.md\n";
    const parsed = parse(two).def!;
    expect([parsed.agent, ...parsed.steps.map((s) => s.agent)]).toEqual(["copilot", "claude", "copilot"]);
  });

  it("rejects an unknown agent", () => {
    const { def, errors } = parse("version: 2\nagent: codex\nsteps:\n  - id: a\n    prompt: p.md\n    agent: gpt\n");
    expect(def).toBeNull();
    expect(errors).toEqual(["agent must be one of claude, copilot", "steps[0].agent must be one of claude, copilot"]);
  });

  describe("model", () => {
    const two = (top: string, a = "", b = "") => `version: 2\n${top}steps:\n  - id: a\n    prompt: p.md\n${a}  - id: b\n    prompt: p.md\n${b}`;

    it("gives each step its own model, else the workflow's; default and inherit pass none", () => {
      const { def, errors } = parse(two("model: opus\n", "    model: claude-haiku-5-5\n", ""));
      expect(errors).toEqual([]);
      expect(def!.model).toBe("opus");
      expect(def!.steps.map((s) => s.model)).toEqual(["claude-haiku-5-5", "opus"]);

      const off = parse(two("model: sonnet[1m]\n", "    model: default\n", "    model: inherit\n")).def!;
      expect(off.steps.map((s) => s.model)).toEqual([undefined, undefined]);

      const none = parse(two("")).def!;
      expect(none.model).toBeUndefined();
      expect(none.steps.map((s) => s.model)).toEqual([undefined, undefined]);
    });

    it("checks a Claude step's model and takes any one-word model for Copilot", () => {
      const bad = parse(two("model: gpt-5\n", "    model: -p\n", "    model: [opus]\n"));
      expect(bad.def).toBeNull();
      expect(bad.errors).toEqual([
        "model gpt-5 is not a Claude model; use one of default, inherit, haiku, sonnet, opus, fable, opusplan or an id like claude-sonnet-5-5",
        "steps[0].model -p must be a model name (one word, not starting with -)",
        "steps[1].model must be a model name (one word, not starting with -)",
      ]);

      const copilot = parse(two("agent: copilot\nmodel: gpt-5.1-codex\n", "", "    agent: claude\n    model: sonnet\n"));
      expect(copilot.errors).toEqual([]);
      expect(copilot.def!.steps.map((s) => [s.agent, s.model])).toEqual([
        ["copilot", "gpt-5.1-codex"],
        ["claude", "sonnet"],
      ]);
    });

    it("checks the workflow's model against a step that runs another agent", () => {
      const { errors } = parse(two("agent: copilot\nmodel: gpt-5\n", "    agent: claude\n"));
      expect(errors).toEqual([
        "steps[0]: the workflow's model gpt-5 is not a Claude model; use one of default, inherit, haiku, sonnet, opus, fable, opusplan or an id like claude-sonnet-5-5; give this step a model of its own",
      ]);
    });
  });

  describe("dispatch step", () => {
    const head = "version: 2\nsteps:\n  - id: plan\n    agent: copilot\n    prompt: p.md\n    outputs: [{id: plan, file: plan.md}]\n    done-when: plan\n    gate: approve\n";
    const review = "  - id: review\n    prompt: p.md\n    outputs: [{id: rev, file: rev.md}]\n    done-when: rev\n";
    const dispatch = (body: string) => `  - id: work\n    dispatch:\n${body}`;
    const ok = "      from: plan\n      prompt: sub.md\n      report: 03-viec-{{n}}.md\n";
    const subtask = { "sub.md": "{{subtask}} {{subtaskReport}} {{outputs}}" };

    it("reads from, prompt, report, format and parallel, and takes the agent of the step that writes the table", () => {
      const { def, errors } = parse(head + dispatch(`${ok}      format: fmt.md\n      parallel: 2\n`) + review, { ...subtask, "fmt.md": "# {{key}}" });
      expect(errors).toEqual([]);
      expect(def!.steps[1]).toMatchObject({
        id: "work",
        agent: "copilot",
        gate: "none",
        outputs: [],
        dispatch: { from: "plan", promptFile: "sub.md", report: "03-viec-{{n}}.md", format: "fmt.md", formatText: "# {{key}}", parallel: 2 },
      });
    });

    it("ships a leader template that parses without errors or warnings", async () => {
      const { def, errors, warnings } = parseWorkflowFiles(await readWorkflowDir(LEADER_WORKFLOW_DIR), { dir: LEADER_WORKFLOW_DIR, origin: "default" });
      expect({ errors, warnings }).toEqual({ errors: [], warnings: [] });
      expect(def!.steps.map((s) => [s.id, s.agent, s.gate, !!s.dispatch])).toEqual([
        ["investigate", "claude", "approve", false],
        ["dispatch", "claude", "none", true],
        ["review", "claude", "approve", false],
      ]);
      expect(def!.steps[1].dispatch).toMatchObject({ from: "plan", report: "03-viec-{{n}}.md", parallel: 1, promptFile: "subtask.md", format: "format-subtask.md" });
    });

    it("defaults parallel to 1, and a workflow without dispatch is unchanged", () => {
      expect(parse(head + dispatch(ok) + review, subtask).def!.steps[1].dispatch!.parallel).toBe(1);
      expect(parse(ONE_STEP).def!.steps[0].dispatch).toBeUndefined();
    });

    it.each([
      ["a prompt of its own", `${dispatch(ok)}    prompt: p.md\n`, "steps[1]: a dispatch step has no `prompt`"],
      ["a gate", `${dispatch(ok)}    gate: approve\n`, "steps[1]: a dispatch step has no `gate`"],
      ["a model", `${dispatch(ok)}    model: opus\n`, "steps[1]: a dispatch step has no `model`"],
      ["a `from` that is not an earlier output", dispatch(ok.replace("from: plan", "from: rev")), "steps[1].dispatch.from must be the id of an output of an earlier step"],
      ["a report without {{n}}", dispatch(ok.replace("{{n}}", "x")), "steps[1].dispatch.report must contain {{n}}, e.g. 03-viec-{{n}}.md"],
      ["a report outside the task directory", dispatch(ok.replace("03-viec-{{n}}.md", "a/{{n}}.md")), "steps[1].dispatch.report must be a .md file name at the top of the task directory"],
      ["parallel above 4", dispatch(`${ok}      parallel: 5\n`), "steps[1].dispatch.parallel must be an integer from 1 to 4"],
      ["parallel 0", dispatch(`${ok}      parallel: 0\n`), "steps[1].dispatch.parallel must be an integer from 1 to 4"],
    ])("rejects %s", (_name, step, error) => {
      const { def, errors } = parse(head + step + review, subtask);
      expect(def).toBeNull();
      expect(errors.some((e) => e.startsWith(error))).toBe(true);
    });

    it("needs a step after it and allows only one", () => {
      expect(parse(head + dispatch(ok), subtask).errors).toContain("steps[1]: a dispatch step needs a review step after it");
      const twice = parse(head + dispatch(ok) + dispatch(ok).replace("id: work", "id: work2") + review, subtask);
      expect(twice.errors).toContain("steps[2]: only one dispatch step is allowed");
    });

    it("lets {{subtask}} and {{subtaskReport}} appear in the subtask prompt only; {{subtasks}} anywhere", () => {
      const bad = parse(head + dispatch(ok) + review, { ...subtask, "p.md": "{{subtask}} {{subtasks}} {{outputs}}" });
      expect(bad.errors).toEqual(Array(2).fill("p.md: {{subtask}} is only available in the dispatch step's prompt"));
    });
  });

  it("injects every hook through curl with the session's env", () => {
    const settings = JSON.parse(hookSettings()) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('"$TASKPILOT_HOOK_URL/Stop"');
  });
});
