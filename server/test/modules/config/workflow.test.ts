import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW_DIR } from "../../../src/modules/workflow/definition.js";
import { get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

const dir = () => path.join(repo, ".claude", "taskpilot");
const BUILT_IN = [
  "format-history.md",
  "format-investigation.md",
  "format-plan.md",
  "format-progress.md",
  "format-summary.md",
  "implement.md",
  "investigate.md",
  "revise-implementation.md",
  "revise-plan.md",
  "workflow.yml",
];

/** Contents of TaskPilot's own workflow, to prove no route ever writes there. */
let pristine: Record<string, string>;
beforeAll(async () => {
  pristine = Object.fromEntries(await Promise.all(BUILT_IN.map(async (n) => [n, await readFile(path.join(DEFAULT_WORKFLOW_DIR, n), "utf8")])));
});

async function builtInUnchanged() {
  expect((await readdir(DEFAULT_WORKFLOW_DIR)).sort()).toEqual(BUILT_IN);
  for (const [n, text] of Object.entries(pristine)) expect(await readFile(path.join(DEFAULT_WORKFLOW_DIR, n), "utf8")).toBe(text);
}

const raw = (name: string) => get(`/api/config/workflow/file?name=${name}`);
const put = async (name: string, content: string) => send("PUT", "/api/config/workflow/file", { name, content, baseHash: (await raw(name)).hash });

describe("workflow config", () => {
  it("shows the built-in workflow read only until the repo adds an override", async () => {
    const view = await get("/api/config/workflow");
    expect(view).toMatchObject({ origin: "default", overrideDir: ".claude/taskpilot", errors: [], warnings: [] });
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

  it("creates the override as a copy of the built-in workflow, with backups", async () => {
    const res = await send("POST", "/api/config/workflow/override");
    expect(res.statusCode).toBe(200);
    expect(res.json().files.at(-1)).toBe(".claude/taskpilot/workflow.yml");
    expect((await readdir(dir())).sort()).toEqual(BUILT_IN);
    for (const n of BUILT_IN) expect(await readFile(path.join(dir(), n), "utf8")).toBe(pristine[n]);

    const view = await get("/api/config/workflow");
    expect(view).toMatchObject({ origin: "repo", dir: ".claude/taskpilot" });
    expect(view.files.every((f: { sameAsDefault: boolean }) => f.sameAsDefault)).toBe(true);
    expect((await get("/api/backups")).filter((b: { existed: boolean }) => !b.existed)).toHaveLength(BUILT_IN.length);
    expect((await send("POST", "/api/config/workflow/override")).statusCode).toBe(409);
  });

  it("refuses to create the override over files already in .claude/taskpilot/", async () => {
    await send("POST", "/api/config/workflow/override");
    await send("POST", "/api/config/workflow/reset", { hashes: Object.fromEntries((await get("/api/config/workflow")).files.map((f: { name: string; hash: string }) => [f.name, f.hash])) });
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), "implement.md"), "mine");
    const res = await send("POST", "/api/config/workflow/override");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("implement.md");
    expect(await readFile(path.join(dir(), "implement.md"), "utf8")).toBe("mine");
  });

  it("validates every save and delete against the whole override", async () => {
    await send("POST", "/api/config/workflow/override");
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
    await send("POST", "/api/config/workflow/override");
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

    await send("POST", "/api/config/workflow/override");
    const yml = (await raw("workflow.yml")).content as string;
    const drafted = await send("POST", "/api/config/workflow/render", {
      stepId: "investigate",
      kind: "onReject",
      feedback: "Thêm test",
      drafts: { "workflow.yml": yml.replace("01-investigation.md", "01-dieu-tra.md") },
    });
    expect(drafted.json().text).toContain("Thêm test");
    expect(drafted.json().text).toContain(".claude/tasks/TASK-1/01-dieu-tra.md nếu liên quan");
    expect((await send("POST", "/api/config/workflow/render", { stepId: "nope", kind: "prompt" })).statusCode).toBe(404);
  });

  it("shows how a file differs from the built-in one and removes the override with backups", async () => {
    await send("POST", "/api/config/workflow/override");
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

    const backup = (await get("/api/backups")).find((b: { display: string; existed: boolean }) => b.display === ".claude/taskpilot/implement.md" && b.existed);
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
    await send("POST", "/api/config/workflow/override");
    await writeFile(path.join(dir(), "workflow.yml"), "version: 2\nsteps: nope\n");
    expect((await get("/api/tasks")).find((t: { key: string }) => t.key === "DEMO-1").stage).toEqual({ done: 0, total: 0, step: null });
  });
});
