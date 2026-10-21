import { describe, expect, it } from "vitest";
import { parseWorkflowFiles, readWorkflowDir } from "../../../src/modules/workflow/definition.js";
import { mergeOverride } from "../../../src/modules/workflow/merge.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";

const where = { dir: "/wf", origin: "repo" as const };
const ov = (yml: string, extra: Record<string, string> = {}) => new Map(Object.entries({ "workflow.yml": yml, ...extra }));

async function merged(mode: string, yml: string, extra: Record<string, string> = {}) {
  const base = await readWorkflowDir(modeDir(mode));
  const m = mergeOverride(base, ov(yml, extra));
  return { m, parsed: m.errors.length ? null : parseWorkflowFiles(m.files, where) };
}

describe("mergeOverride", () => {
  it("patches a step by id and keeps the rest of the base", async () => {
    const { m, parsed } = await merged("default", "extends: default\nsteps:\n  - id: implement\n    title: Làm\n");
    expect(m.errors).toEqual([]);
    expect(parsed!.errors).toEqual([]);
    expect(parsed!.def!.steps.map((s) => s.id)).toEqual(["investigate", "implement"]);
    expect(parsed!.def!.steps[1].title).toBe("Làm");
    expect(m.provenance.steps.map((s) => s.status)).toEqual(["builtin", "patched"]);
  });

  it("adds a step next to a base step and a file of its own", async () => {
    const { m, parsed } = await merged(
      "default",
      "extends: default\nsteps:\n  - id: lint\n    prompt: lint.md\n    after: investigate\n",
      { "lint.md": "Lint {{key}}" },
    );
    expect(parsed!.errors).toEqual([]);
    expect(parsed!.def!.steps.map((s) => s.id)).toEqual(["investigate", "lint", "implement"]);
    expect(m.provenance.files["lint.md"]).toBe("added");
    expect(m.provenance.steps[1].status).toBe("added");
  });

  it("refuses a new step without a position and one next to dispatch", async () => {
    expect((await merged("default", "extends: default\nsteps:\n  - id: lint\n    prompt: lint.md\n", { "lint.md": "x" })).m.errors).not.toEqual([]);
    const { m, parsed } = await merged("leader", "extends: leader\nsteps:\n  - id: lint\n    prompt: lint.md\n    after: investigate\n", { "lint.md": "x" });
    expect([...m.errors, ...(parsed?.errors ?? [])]).not.toEqual([]);
  });

  it("only lets an override patch the dispatch step's own keys", async () => {
    const bad = await merged("leader", "extends: leader\nsteps:\n  - id: dispatch\n    dispatch:\n      from: x\n");
    expect(bad.m.errors).not.toEqual([]);
    const ok = await merged("leader", "extends: leader\nsteps:\n  - id: dispatch\n    dispatch:\n      parallel: 1\n");
    expect(ok.m.errors).toEqual([]);
    expect(ok.parsed!.def!.steps.find((s) => s.dispatch)?.dispatch?.parallel).toBe(1);
  });

  it("replaces a base file of the same name", async () => {
    const { m } = await merged("default", "extends: default\n", { "investigate.md": "Mine {{key}}" });
    expect(m.files.get("investigate.md")).toBe("Mine {{key}}");
    expect(m.provenance.files["investigate.md"]).toBe("replaced");
  });
});
