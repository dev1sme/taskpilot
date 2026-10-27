import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { StateStore } from "../../../src/core/state.js";
import { DEFAULT_WORKFLOW_DIR } from "../../../src/modules/workflow/definition.js";
import { modeDir } from "../../../src/modules/workflow/modes.js";
import { app, get, ok, repo, send, state, useConfigApp } from "../../helpers/configApp.js";
import { makeRepo } from "../../helpers/fixtures.js";

useConfigApp();

const dir = () => path.join(repo, ".taskpilot");
const BUILT_IN = ["format-history.md", "format-plan.md", "format-summary.md", "implement.md", "investigate.md", "revise-implementation.md", "revise-plan.md", "workflow.yml"];

/** Contents of TaskPilot's own workflow, to prove no route ever writes there. */
let pristine: Record<string, string>;
beforeAll(async () => {
  pristine = Object.fromEntries(await Promise.all(BUILT_IN.map(async (n) => [n, await readFile(path.join(DEFAULT_WORKFLOW_DIR, n), "utf8")])));
});

async function builtInUnchanged() {
  expect((await readdir(DEFAULT_WORKFLOW_DIR)).sort()).toEqual(BUILT_IN);
  for (const [n, text] of Object.entries(pristine)) expect(await readFile(path.join(DEFAULT_WORKFLOW_DIR, n), "utf8")).toBe(text);
}

/** A complete override (no `extends`), as repos had before modes: a copy of a built-in mode's files. */
async function legacy(mode = "default") {
  await mkdir(dir(), { recursive: true });
  for (const n of await readdir(modeDir(mode))) await writeFile(path.join(dir(), n), await readFile(path.join(modeDir(mode), n), "utf8"));
}

const raw = (name: string) => get(`/api/config/workflow/file?name=${name}`);
const put = async (name: string, content: string) => send("PUT", "/api/config/workflow/file", { name, content, baseHash: (await raw(name)).hash });

const defaultsUrl = "/api/config/workflow/execution-defaults";
const saveDefaults = async (execution: unknown) => send("PUT", defaultsUrl, { execution, baseHash: (await get(defaultsUrl)).hash });

describe("repo execution defaults", () => {
  it("reads absent/mode-only settings and saves, clears and restores defaults with backups", async () => {
    expect(await get(defaultsUrl)).toEqual({ execution: null, executionVersion: null, errors: [], hash: "absent", settingsPath: ".taskpilot/settings.yml" });
    expect((await app.inject({ url: defaultsUrl, headers: { host: ok.host } })).statusCode).toBe(401);
    const created = await saveDefaults({ agent: "codex", model: "gpt-test" });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ execution: { agent: "codex", model: "gpt-test" }, executionVersion: 1, errors: [], backup: { existed: false } });
    await send("PUT", "/api/config/workflow/mode", { mode: "leader" });
    const before = await readFile(path.join(dir(), "settings.yml"), "utf8");
    const cleared = await saveDefaults(null);
    expect(cleared.json()).toMatchObject({ execution: null, executionVersion: null, errors: [], backup: { existed: true } });
    expect((await get("/api/config/workflow/modes")).selected).toBe("leader");
    expect(await readFile(path.join(dir(), "settings.yml"), "utf8")).not.toContain("execution");
    expect((await send("POST", `/api/backups/${cleared.json().backup.id}/restore`)).statusCode).toBe(200);
    expect(await readFile(path.join(dir(), "settings.yml"), "utf8")).toBe(before);
    expect((await saveDefaults({ agent: "workflow" })).json()).toMatchObject({ execution: { agent: "workflow" }, errors: [] });
  });

  it("guards stale saves and no-ops, including mode changes from newer clients", async () => {
    await send("PUT", "/api/config/workflow/mode", { mode: "leader" });
    const before = await get(defaultsUrl);
    const saved = (await saveDefaults({ agent: "codex" })).json();
    const backups = await get("/api/backups");
    expect((await send("PUT", defaultsUrl, { execution: { agent: "copilot" }, baseHash: before.hash })).statusCode).toBe(409);
    expect((await send("PUT", defaultsUrl, { execution: { agent: "codex" }, baseHash: before.hash })).statusCode).toBe(409);
    expect((await send("PUT", "/api/config/workflow/mode", { mode: "default", baseHash: before.hash })).statusCode).toBe(409);
    const noop = await saveDefaults({ agent: "codex" });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).not.toHaveProperty("backup");
    expect(noop.json().hash).toBe(saved.hash);
    expect(await get("/api/backups")).toEqual(backups);
    const modes = await get("/api/config/workflow/modes");
    expect(modes.hash).toBe(saved.hash);
    expect((await send("PUT", "/api/config/workflow/mode", { mode: "default", baseHash: modes.hash })).statusCode).toBe(200);
  });

  it.each([
    {},
    { execution: { agent: "codex" } },
    { execution: null, baseHash: 1 },
    { execution: { agent: "bad" }, baseHash: "absent" },
    { execution: { agent: "workflow", model: "x" }, baseHash: "absent" },
    { execution: { agent: "claude", model: "gpt-test" }, baseHash: "absent" },
    { execution: [], baseHash: "absent" },
    { execution: { agent: "codex", extra: true }, baseHash: "absent" },
    { execution: null, baseHash: "absent", extra: true },
  ])("rejects invalid requests without writes: %j", async (body) => {
    expect((await send("PUT", defaultsUrl, body)).statusCode).toBe(400);
    expect((await get(defaultsUrl)).hash).toBe("absent");
    expect(await get("/api/backups")).toEqual([]);
  });

  it.each([
    ["mode: [unclosed\n", "settings"],
    ["mode: []\n", "mode"],
    ["executionVersion: 2\nexecution: {agent: codex}\n", "executionVersion"],
    ["execution: {agent: unknown}\n", "execution.agent"],
    ["execution: {agent: codex, future: true}\n", "execution"],
    ["execution: []\n", "execution"],
  ])("reports invalid settings and refuses unsafe replacement: %s", async (text, field) => {
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), "settings.yml"), text);
    const view = await get(defaultsUrl);
    expect(view.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
    const result = await saveDefaults({ agent: "codex" });
    // Known invalid values may be explicitly corrected; malformed YAML, unknown fields,
    // unsupported versions and unrelated invalid mode must never be silently discarded.
    if (field === "execution.agent") {
      expect(result.statusCode).toBe(200);
      expect(result.json().errors).toEqual([]);
    } else {
      expect(result.statusCode).toBe(400);
      expect(result.json().problems.length).toBeGreaterThan(0);
      expect(await readFile(path.join(dir(), "settings.yml"), "utf8")).toBe(text);
      expect(await get("/api/backups")).toEqual([]);
    }
  });

  it("isolates defaults from another repo, run state and workflow files", async () => {
    const before = structuredClone(await state.load());
    await saveDefaults({ agent: "codex" });
    expect(await state.load()).toEqual(before);
    expect(await readdir(dir())).toEqual(["settings.yml"]);
    const other = await makeRepo();
    expect((await send("PUT", "/api/repo", { path: other })).statusCode).toBe(200);
    expect((await get(defaultsUrl)).execution).toBeNull();
    await saveDefaults({ agent: "copilot" });
    expect((await send("PUT", "/api/repo", { path: repo })).statusCode).toBe(200);
    expect((await get(defaultsUrl)).execution).toEqual({ agent: "codex" });
    await builtInUnchanged();
  });
});

describe("workflow config", () => {
  it("resolves explicit preview policy independently from repo defaults and keeps saved YAML intact", async () => {
    await saveDefaults({ agent: "codex", model: "repo-model" });
    await send("POST", "/api/config/workflow/override", { mode: "default" });
    const original = await raw("workflow.yml");
    const content = `${original.content}steps:\n  - id: implement\n    agent: copilot\n    model: workflow-model\n`;
    await put("workflow.yml", content);
    await put("agent-preview.md", "{{agent}} / {{rules}} / {{historyEntry}}");
    const drafts = { "workflow.yml": `${content}    prompt: agent-preview.md\n` };
    const body = { stepId: "implement", kind: "prompt", mode: "default", drafts };
    const yaml = (await send("POST", "/api/config/workflow/render", body)).json();
    expect(yaml).toMatchObject({ execution: { agent: "workflow" }, source: "workflow", effective: { agent: "copilot", model: "workflow-model", source: "workflow" } });
    expect(yaml.text).toContain("Copilot");
    const codex = (await send("POST", "/api/config/workflow/render", { ...body, execution: { agent: "codex" } })).json();
    expect(codex).toMatchObject({ execution: { agent: "codex" }, source: "request", effective: { agent: "codex", modelSource: "default", source: "execution" } });
    expect(codex.effective).not.toHaveProperty("model");
    expect(codex.text).toContain("Codex");
    const model = (await send("POST", "/api/config/workflow/render", { ...body, execution: { agent: "codex", model: "chosen-model" } })).json();
    expect(model.effective.model).toBe("chosen-model");
    const explicitWorkflow = (await send("POST", "/api/config/workflow/render", { ...body, execution: { agent: "workflow" } })).json();
    expect(explicitWorkflow.effective).toEqual(yaml.effective);
    expect((await raw("workflow.yml")).content).toBe(content);
    expect((await get(defaultsUrl)).execution).toEqual({ agent: "codex", model: "repo-model" });
    expect((await state.load()).runs).toEqual([]);
    expect((await state.load()).sessions).toEqual([]);
  });

  it("resolves sample dispatch/rejection previews and blocks invalid policy or permissions", async () => {
    const sub = (await send("POST", "/api/config/workflow/render", { mode: "leader", stepId: "dispatch", kind: "subtask", execution: { agent: "codex", model: "member-model" } })).json();
    expect(sub).toMatchObject({ effective: { agent: "codex", model: "member-model", source: "execution" } });
    expect(sub.text).toContain("member-model");
    const reject = (await send("POST", "/api/config/workflow/render", { stepId: "investigate", kind: "onReject", execution: { agent: "copilot" }, feedback: "Sửa lại" })).json();
    expect(reject.effective.agent).toBe("copilot");
    expect(reject.text).toContain("Sửa lại");
    const invalid = await send("POST", "/api/config/workflow/render", { stepId: "investigate", kind: "prompt", execution: { agent: "wrong" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().problems[0].field).toBe("execution.agent");
    await send("POST", "/api/config/workflow/override", { mode: "default" });
    const yml = (await raw("workflow.yml")).content;
    const blocked = await send("POST", "/api/config/workflow/render", {
      mode: "default",
      stepId: "investigate",
      kind: "prompt",
      execution: { agent: "codex" },
      drafts: { "workflow.yml": `${yml}permission-mode: plan\n` },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().problems[0].field).toBe("permissionMode");
    expect((await state.load()).sessions).toEqual([]);
  });

  it("shows the built-in workflow read only until the repo adds an override", async () => {
    const view = await get("/api/config/workflow");
    expect(view).toMatchObject({ origin: "default", overrideDir: ".taskpilot", errors: [], warnings: [] });
    expect(view.def.steps.map((s: { id: string; doneWhen: string }) => [s.id, s.doneWhen])).toEqual([
      ["investigate", "plan"],
      ["implement", "summary"],
    ]);
    expect(view.files.map((f: { name: string }) => f.name)).toEqual(BUILT_IN);
    expect(view.files.find((f: { name: string }) => f.name === "investigate.md").usedBy).toEqual(["Điều tra & lên kế hoạch"]);
    expect(view.variables).toContain("previousRun");

    // Nothing can be written before the override exists.
    expect((await send("PUT", "/api/config/workflow/file", { name: "investigate.md", content: "x", baseHash: "absent" })).statusCode).toBe(409);
    await builtInUnchanged();
  });

  it("lists the modes, keeps the repo's choice and shows each mode read only", async () => {
    const { modes, selected } = await get("/api/config/workflow/modes");
    expect(modes.map((m: { id: string }) => m.id)).toEqual(["default", "leader"]);
    expect(modes.map((m: { name: string }) => m.name)).toEqual(["Mặc định", "Leader"]);
    expect(selected).toBe("default");

    expect((await send("PUT", "/api/config/workflow/mode", { mode: "nope" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/workflow/mode", { mode: "custom" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/workflow/mode", { mode: "leader" })).statusCode).toBe(200);
    expect((await get("/api/config/workflow/modes")).selected).toBe("leader");
    expect(await readFile(path.join(dir(), "settings.yml"), "utf8")).toContain("\nmode: leader\n");
    expect((await state.load()) as object).not.toHaveProperty("repoModes");
    expect((await get("/api/config/workflow")).settingsPath).toBe(".taskpilot/settings.yml");

    const view = await get("/api/config/workflow");
    expect(view).toMatchObject({ origin: "default", mode: { id: "leader", override: false }, errors: [], warnings: [] });
    expect(view.def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "dispatch", "review"]);
    expect(view.def.steps[1].dispatch).toMatchObject({ from: "plan", promptFile: "subtask.md", report: "03-viec-{{n}}.md", format: "format-subtask.md", parallel: 1 });
    const used = (name: string) => view.files.find((f: { name: string }) => f.name === name).usedBy;
    expect(used("subtask.md")).toEqual([view.def.steps[1].title]);
    // Another mode on request, whatever the repo's choice.
    expect((await get("/api/config/workflow?mode=default")).def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "implement"]);
    expect((await app.inject({ url: "/api/config/workflow?mode=nope", headers: ok })).statusCode).toBe(400);

    const text = (await send("POST", "/api/config/workflow/render", { stepId: "dispatch", kind: "subtask" })).json().text;
    expect(text).toContain("Tên việc mẫu");
    expect(text).toContain("03-viec-1.md");
    expect((await send("POST", "/api/config/workflow/render", { stepId: "dispatch", kind: "prompt" })).statusCode).toBe(404);
    expect((await send("POST", "/api/config/workflow/render", { stepId: "review", kind: "subtask" })).statusCode).toBe(404);
    expect((await send("POST", "/api/config/workflow/render", { stepId: "review", kind: "prompt" })).statusCode).toBe(200);
    expect((await send("POST", "/api/config/workflow/render", { stepId: "implement", kind: "prompt", mode: "default" })).statusCode).toBe(200);

    // The leader's prompt lists the repo's real subagents, as a run would.
    await mkdir(path.join(repo, ".claude", "agents"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "agents", "render-helper.md"), "---\nname: render-helper\ndescription: Helps.\ntools: Read, Write\n---\n\nBody\n");
    const leader = (await send("POST", "/api/config/workflow/render", { stepId: "investigate", kind: "prompt" })).json().text;
    expect(leader).toContain("`render-helper`");
    await builtInUnchanged();
  });

  it("creates an `extends` override of one file, applied to its own mode only", async () => {
    expect((await send("POST", "/api/config/workflow/override", { mode: "other" })).statusCode).toBe(400);
    const res = await send("POST", "/api/config/workflow/override", { mode: "leader" });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual([".taskpilot/workflow.yml"]);
    expect(await readdir(dir())).toEqual(["workflow.yml"]);
    expect(await readFile(path.join(dir(), "workflow.yml"), "utf8")).toContain("extends: leader");
    expect((await send("POST", "/api/config/workflow/override", { mode: "default" })).statusCode).toBe(409);
    expect((await get("/api/backups")).filter((b: { existed: boolean }) => !b.existed)).toHaveLength(1);

    // With nothing chosen, the repo follows its override's mode, whose view is the merge: all of Leader here.
    const view = await get("/api/config/workflow");
    expect(view).toMatchObject({ origin: "repo", overrideKind: "extends", overrideExtends: "leader", selected: "leader", mode: { id: "leader", override: true }, errors: [], warnings: [] });
    expect(view.def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "dispatch", "review"]);
    expect(view.files.map((f: { name: string }) => f.name)).toEqual(["workflow.yml"]);

    // Patch a step and add one: the page shows where each comes from.
    const yml = (await raw("workflow.yml")).content as string;
    const patched = `${yml}steps:\n  - id: investigate\n    agent: copilot\n  - id: lint\n    before: investigate\n    prompt: lint.md\n`;
    expect((await put("workflow.yml", patched)).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/workflow/file", { name: "lint.md", content: "Lint {{key}}", baseHash: "absent" })).statusCode).toBe(200);
    expect((await put("workflow.yml", patched)).statusCode).toBe(200);
    const merged = await get("/api/config/workflow");
    expect(merged.def.steps.map((s: { id: string }) => s.id)).toEqual(["lint", "investigate", "dispatch", "review"]);
    expect(merged.provenance.steps.map((s: { status: string }) => s.status)).toEqual(["added", "patched", "builtin", "builtin"]);
    expect(merged.files.map((f: { name: string }) => f.name).sort()).toEqual(["lint.md", "workflow.yml"]);
    expect(merged.resolved["investigate.md"]).toBeTruthy();
    expect(merged.def.steps[1].agent).toBe("copilot");
    expect(merged.files.find((f: { name: string }) => f.name === "lint.md").provenance).toBe("added");

    // The override does not apply to another mode.
    const other = await get("/api/config/workflow?mode=default");
    expect(other).toMatchObject({ origin: "default", mode: { id: "default", override: false } });
    expect(other.def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "implement"]);

    // A change that breaks the engine's part of the merged workflow is refused.
    expect((await put("workflow.yml", `${yml}steps:\n  - id: dispatch\n    dispatch:\n      from: investigation\n`)).statusCode).toBe(400);
    expect((await put("workflow.yml", `${yml}steps:\n  - id: x\n    before: dispatch\n    prompt: lint.md\n`)).json().error).toContain("dispatch");
    await builtInUnchanged();
  });

  it("refuses to create the override over files of the mode already in .taskpilot/", async () => {
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), "implement.md"), "mine");
    const res = await send("POST", "/api/config/workflow/override", { mode: "default" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("implement.md");
    expect(await readFile(path.join(dir(), "implement.md"), "utf8")).toBe("mine");
  });

  it("moves a complete override to `extends`, keeping only what differs from its base", async () => {
    await legacy("leader");
    await writeFile(path.join(dir(), "review.md"), `${await readFile(path.join(dir(), "review.md"), "utf8")}\nMine`);
    const files = (await get("/api/config/workflow")).files as Array<{ name: string; hash: string }>;
    const hashes = Object.fromEntries(files.map((f) => [f.name, f.hash]));
    expect(await get("/api/config/workflow")).toMatchObject({ overrideKind: "legacy", selected: "custom", mode: { id: "custom", override: true } });

    const preview = await send("POST", "/api/config/workflow/override/migrate", {});
    expect(preview.json()).toMatchObject({ base: "leader", errors: [], applied: false });
    expect(preview.json().remove).toContain("investigate.md");
    expect(preview.json().remove).not.toContain("review.md");
    expect(await readdir(dir())).toHaveLength(files.length);

    expect((await send("POST", "/api/config/workflow/override/migrate", { apply: true, hashes: { ...hashes, "review.md": "old" } })).statusCode).toBe(409);
    expect((await send("POST", "/api/config/workflow/override/migrate", { apply: true, hashes })).json().applied).toBe(true);
    expect((await readdir(dir())).sort()).toEqual(["review.md", "workflow.yml"]);
    const after = await get("/api/config/workflow");
    expect(after).toMatchObject({ overrideKind: "extends", overrideExtends: "leader", errors: [], warnings: [] });
    expect(after.def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "dispatch", "review"]);
    expect((await send("POST", "/api/config/workflow/override/migrate", {})).statusCode).toBe(409);

    // A complete workflow without a step of its base cannot be written as `extends`.
    await send("POST", "/api/config/workflow/reset", { hashes: Object.fromEntries(after.files.map((f: { name: string; hash: string }) => [f.name, f.hash])) });
    await legacy("default");
    const yml = await readFile(path.join(dir(), "workflow.yml"), "utf8");
    await writeFile(path.join(dir(), "workflow.yml"), yml.slice(0, yml.indexOf("  - id: implement")));
    const refused = (await send("POST", "/api/config/workflow/override/migrate", { base: "default" })).json();
    expect(refused.errors[0]).toContain("implement");
  });

  it("keeps settings.yml when the override is removed, and falls back to default on a broken one", async () => {
    await send("PUT", "/api/config/workflow/mode", { mode: "leader" });
    await legacy("default");
    const files = (await get("/api/config/workflow?mode=custom")).files as { name: string; hash: string }[];
    expect(files.map((f) => f.name)).not.toContain("settings.yml");
    expect((await send("POST", "/api/config/workflow/reset", { hashes: Object.fromEntries(files.map((f) => [f.name, f.hash])) })).statusCode).toBe(200);
    expect((await readdir(dir())).sort()).toEqual(["settings.yml"]);
    expect((await get("/api/config/workflow/modes")).selected).toBe("leader");
    const backups = await get("/api/backups");
    expect(backups.some((b: { display: string }) => b.display === ".taskpilot/settings.yml")).toBe(true);

    await writeFile(path.join(dir(), "settings.yml"), "mode: [unclosed\n");
    expect((await get("/api/config/workflow/modes")).selected).toBe("default");
  });

  it("drops the old repoModes key from state.json on load", async () => {
    await writeFile(state.file, JSON.stringify({ repoModes: { [repo]: "leader" }, sessions: [], runs: [] }));
    const fresh = new StateStore(state.dir);
    expect(await fresh.load()).not.toHaveProperty("repoModes");
    await fresh.update(() => undefined);
    expect(JSON.parse(await readFile(state.file, "utf8"))).not.toHaveProperty("repoModes");
  });

  it("validates every save and delete against the whole override", async () => {
    await legacy();
    const yml = (await raw("workflow.yml")).content as string;

    const bad = await put("workflow.yml", yml.replace("done-when: plan", "done-when: nope"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain("done-when");
    expect(await readFile(path.join(dir(), "workflow.yml"), "utf8")).toBe(yml);

    const preview = await send("POST", "/api/config/workflow/preview", {
      name: "workflow.yml",
      content: yml.replace("02-plan.md", "02-ke-hoach.md"),
      baseHash: (await raw("workflow.yml")).hash,
    });
    expect(preview.json()).toMatchObject({ changed: true, stale: false, warnings: [] });
    expect(preview.json().diff).toContain("+        file: 02-ke-hoach.md");

    expect((await put("investigate.md", "{{out.nothing}}")).statusCode).toBe(400);
    expect((await put("investigate.md", "{{previousRun}} New {{outputs}} {{specdir}}")).statusCode).toBe(200);
    expect((await send("POST", "/api/config/workflow/validate", { name: "implement.md", content: "{{feedback}}" })).json().errors[0]).toContain("on-reject");

    // A new prompt file, then a step that uses it.
    expect((await send("PUT", "/api/config/workflow/file", { name: "review.md", content: "Review {{key}}", baseHash: "absent" })).statusCode).toBe(200);
    expect((await get("/api/config/workflow")).warnings).toContain("review.md is not used by any step");
    expect((await put("workflow.yml", `${yml}  - id: review\n    prompt: review.md\n`)).statusCode).toBe(200);
    expect((await get("/api/config/workflow")).def.steps.map((s: { id: string }) => s.id)).toEqual(["investigate", "implement", "review"]);

    // A prompt in use cannot go; workflow.yml only goes with the whole override.
    const reviewHash = (await raw("review.md")).hash;
    expect((await send("DELETE", `/api/config/workflow/file?name=review.md&baseHash=${reviewHash}`)).statusCode).toBe(400);
    expect((await send("DELETE", "/api/config/workflow/file?name=workflow.yml&baseHash=x")).statusCode).toBe(400);
    expect((await put("../evil.md", "x")).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/workflow/file", { name: "sub/x.md", content: "x", baseHash: "absent" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/workflow/file", { name: "implement.md", content: "x {{out.plan}}", baseHash: "stale" })).statusCode).toBe(409);
    await builtInUnchanged();
  });

  it("lets a hand-broken override be fixed one file at a time", async () => {
    await legacy();
    const yml = (await raw("workflow.yml")).content as string;
    await writeFile(path.join(dir(), "workflow.yml"), yml.replace("prompt: implement.md", "prompt: code.md"));
    const view = await get("/api/config/workflow");
    expect(view.errors[0]).toContain("file not found: code.md");
    expect(view.def).toBeNull();
    expect((await put("implement.md", "still broken elsewhere {{outputs}}")).statusCode).toBe(200);
    expect((await send("PUT", "/api/config/workflow/file", { name: "code.md", content: "Code {{outputs}}", baseHash: "absent" })).statusCode).toBe(200);
    expect((await get("/api/config/workflow")).errors).toEqual([]);
  });

  it("renders the prompt a step would send for a sample task, drafts included", async () => {
    const res = await send("POST", "/api/config/workflow/render", { stepId: "implement", kind: "prompt" });
    expect(res.json().task).toEqual({ key: "TASK-1", title: "Tên task mẫu" });
    expect(res.json().text).toContain("Thực hiện kế hoạch trong .claude/tasks/TASK-1/02-plan.md.");
    expect(res.json().text).not.toContain("chạy lại từ bước đầu");

    // A simulated restart lists every document as archived; the plan is read first.
    const restarted = (await send("POST", "/api/config/workflow/render", { stepId: "investigate", kind: "prompt", restart: true })).json().text;
    expect(restarted).toContain("Task này được chạy lại từ bước đầu.");
    expect(restarted).toContain("- .claude/tasks/TASK-1/archive/<YYYYMMDD-HHMMSS>/02-plan.md");

    // Without feedback, on-reject prompts show where it goes.
    const sample = (await send("POST", "/api/config/workflow/render", { stepId: "investigate", kind: "onReject" })).json().text;
    expect(sample).toContain("<góp ý của reviewer>");

    await legacy();
    const yml = (await raw("workflow.yml")).content as string;
    const drafted = await send("POST", "/api/config/workflow/render", {
      stepId: "investigate",
      kind: "onReject",
      feedback: "Thêm test",
      drafts: { "workflow.yml": yml.replace("02-plan.md", "02-ke-hoach.md") },
    });
    expect(drafted.json().text).toContain("Thêm test");
    expect(drafted.json().text).toContain(".claude/tasks/TASK-1/02-ke-hoach.md");
    expect((await send("POST", "/api/config/workflow/render", { stepId: "nope", kind: "prompt" })).statusCode).toBe(404);
  });

  it("shows how a file differs from the built-in one and removes the override with backups", async () => {
    await legacy();
    await put("implement.md", "Mine {{out.plan}}");
    const diff = await get("/api/config/workflow/default-diff?name=implement.md");
    expect(diff.same).toBe(false);
    expect(diff.diff).toContain("+Mine {{out.plan}}");

    const files = (await get("/api/config/workflow")).files as Array<{ name: string; hash: string }>;
    const hashes = Object.fromEntries(files.map((f) => [f.name, f.hash]));
    expect((await send("POST", "/api/config/workflow/reset", { hashes: { ...hashes, "implement.md": "old" } })).statusCode).toBe(409);
    expect((await send("POST", "/api/config/workflow/reset", { hashes })).statusCode).toBe(200);
    expect((await get("/api/config/workflow")).origin).toBe("default");
    await expect(readdir(dir())).rejects.toThrow();

    const backup = (await get("/api/backups")).find((b: { display: string; existed: boolean }) => b.display === ".taskpilot/implement.md" && b.existed);
    expect((await send("POST", `/api/backups/${backup.id}/restore`)).statusCode).toBe(200);
    expect(await readFile(path.join(dir(), "implement.md"), "utf8")).toBe("Mine {{out.plan}}");
    await builtInUnchanged();
  });

  it("gives tasks a stage read from the workflow's outputs", async () => {
    const tasks = await get("/api/tasks");
    const demo1 = tasks.find((t: { key: string }) => t.key === "DEMO-1");
    expect(demo1).toMatchObject({ stage: { done: 1, total: 2, step: "Điều tra & lên kế hoạch" }, historyFile: "00-history.md" });
    expect(await get("/api/tasks/DEMO-2")).toMatchObject({ stage: { done: 0, total: 2, step: null } });

    // A broken override must not hide the tasks.
    await legacy();
    await writeFile(path.join(dir(), "workflow.yml"), "version: 2\nsteps: nope\n");
    expect((await get("/api/tasks")).find((t: { key: string }) => t.key === "DEMO-1").stage).toEqual({ done: 0, total: 0, step: null });
  });
});
