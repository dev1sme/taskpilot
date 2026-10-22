import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { get, home, repo, send, useConfigApp } from "../../helpers/configApp.js";
import { SUBAGENTS_DIR } from "../../../src/modules/config/library/templates.js";

useConfigApp();

describe("agents, commands and skills", () => {
  it("creates, edits and deletes with backups", async () => {
    const content = "---\nname: reviewer\ndescription: Reviews\n---\nBody\n";
    const created = await send("PUT", "/api/config/library/agents/project", { rel: "reviewer.md", content, baseHash: "absent" });
    expect(created.statusCode).toBe(200);
    const list = await get("/api/config/agents");
    expect(list.map((a: { rel: string }) => a.rel)).toEqual(["reviewer.md"]);

    const raw = await get("/api/config/library/agents/project/raw?rel=reviewer.md");
    const del = await send("DELETE", `/api/config/library/agents/project?rel=reviewer.md&baseHash=${raw.hash}`);
    expect(del.statusCode).toBe(200);
    expect(await get("/api/config/agents")).toEqual([]);
    expect((await get("/api/backups"))[0]).toMatchObject({ existed: true, display: ".claude/agents/reviewer.md" });

    await send("PUT", "/api/config/library/skills/user", { rel: "deploy/SKILL.md", content: "---\nname: deploy\n---\n", baseHash: "absent" });
    expect(await readFile(path.join(home, "skills", "deploy", "SKILL.md"), "utf8")).toContain("deploy");
    await send("PUT", "/api/config/library/commands/project", { rel: "git/pr.md", content: "Open a PR\n", baseHash: "absent" });
    expect((await get("/api/config/commands")).map((c: { name: string }) => c.name)).toEqual(["git:pr"]);
  });

  it.each([
    ["agents", "../evil.md"],
    ["agents", "a/b/c/d.md"],
    ["skills", "deploy/run.sh"],
    ["commands", "a/b/c/d.md"],
  ])("rejects %s path %s", async (kind, rel) => {
    expect((await send("PUT", `/api/config/library/${kind}/project`, { rel, content: "x", baseHash: "absent" })).statusCode).toBe(400);
  });
});

const TEMPLATES = ["taskpilot-explorer", "taskpilot-implementer", "taskpilot-reviewer", "taskpilot-tester"];

interface Agent {
  name: string;
  scope: string;
  check: { status: string; roles: string[]; problems: string[]; template?: string };
}

const agent = (front: string) => `---\n${front}\n---\nBody\n`;
const putAgent = (scope: "project" | "user", rel: string, content: string) => send("PUT", `/api/config/library/agents/${scope}`, { rel, content, baseHash: "absent" });
const agents = async (): Promise<Agent[]> => get("/api/config/agents");
const byName = async (name: string, scope = "project") => (await agents()).find((a) => a.name === name && a.scope === scope)!;

describe("agent checks", () => {
  it("gives a writing agent both roles and a read-only one only leader", async () => {
    await putAgent("project", "writer.md", agent("name: writer\ndescription: Writes\ntools: Read, Edit, Bash\nmodel: sonnet"));
    await putAgent("project", "all.md", agent("name: all\ndescription: Every tool"));
    await putAgent("project", "reader.md", agent("name: reader\ndescription: Reads\ntools: Read, Grep"));
    await putAgent("project", "denied.md", agent("name: denied\ndescription: No writes\ndisallowedTools: Write, Edit, MultiEdit"));
    expect((await byName("writer")).check).toEqual({ status: "ok", roles: ["leader", "member"], problems: [] });
    expect((await byName("all")).check.roles).toEqual(["leader", "member"]);
    const reader = (await byName("reader")).check;
    expect(reader).toMatchObject({ status: "ok", roles: ["leader"] });
    expect(reader.problems).toHaveLength(1);
    expect((await byName("denied")).check.roles).toEqual(["leader"]);
  });

  it("flags missing fields, a bad model, AskUserQuestion and broken frontmatter", async () => {
    await putAgent("project", "nameless.md", agent("description: No name"));
    await putAgent("project", "badmodel.md", agent("name: badmodel\ndescription: x\nmodel: gpt-4"));
    await putAgent("project", "asker.md", agent("name: asker\ndescription: x\ntools: Read, Write, AskUserQuestion"));
    await putAgent("project", "broken.md", "---\nname: [broken\n---\nBody\n");
    expect((await byName("nameless")).check).toMatchObject({ status: "error", roles: [] });
    const bad = (await byName("badmodel")).check;
    expect(bad).toMatchObject({ status: "error", roles: [] });
    expect(bad.problems.join()).toContain("gpt-4");
    expect((await byName("asker")).check).toMatchObject({ status: "warn", roles: ["leader", "member"] });
    expect((await byName("broken")).check).toMatchObject({ status: "error", roles: [] });
    // Model ids and aliases Claude Code takes are fine.
    await putAgent("project", "idmodel.md", agent("name: idmodel\ndescription: x\nmodel: claude-sonnet-5-5[1m]"));
    expect((await byName("idmodel")).check.status).toBe("ok");
  });

  it("marks a user agent hidden by a project agent of the same name, and duplicates in one scope", async () => {
    await putAgent("project", "helper.md", agent("name: helper\ndescription: Project"));
    await putAgent("user", "helper.md", agent("name: helper\ndescription: User"));
    await putAgent("project", "a.md", agent("name: twin\ndescription: A"));
    await putAgent("project", "b.md", agent("name: twin\ndescription: B"));
    expect((await byName("helper")).check.status).toBe("ok");
    expect((await byName("helper", "user")).check).toMatchObject({ status: "warn", roles: [] });
    expect((await agents()).filter((a) => a.name === "twin").map((a) => a.check.status)).toEqual(["warn", "warn"]);
  });
});

describe("subagent templates", () => {
  it("ships four templates that pass the check", async () => {
    const list = await get("/api/config/agents/templates");
    expect(list.map((x: { name: string }) => x.name)).toEqual(TEMPLATES);
    expect(list.every((x: { exists: boolean }) => !x.exists)).toBe(true);
    for (const name of TEMPLATES) {
      const content = await readFile(path.join(SUBAGENTS_DIR, `${name}.md`), "utf8");
      await putAgent("user", `${name}.md`, content);
    }
    const checks = Object.fromEntries((await agents()).map((a) => [a.name, a.check]));
    expect(checks["taskpilot-explorer"]).toMatchObject({ status: "ok", roles: ["leader"], template: "same" });
    expect(checks["taskpilot-reviewer"]).toMatchObject({ status: "ok", roles: ["leader"] });
    expect(checks["taskpilot-implementer"]).toMatchObject({ status: "ok", roles: ["leader", "member"] });
    expect(checks["taskpilot-tester"]).toMatchObject({ status: "ok", roles: ["leader", "member"] });
  });

  it("previews, installs with backups, then refuses to overwrite unless asked", async () => {
    const preview = (await send("POST", "/api/config/agents/templates/preview", {})).json();
    expect(preview.files).toHaveLength(4);
    expect(preview.diff).toContain("+name: taskpilot-explorer");

    const res = await send("POST", "/api/config/agents/templates/install", { names: TEMPLATES });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual(TEMPLATES.map((n) => `.claude/agents/${n}.md`));
    expect(await readFile(path.join(repo, ".claude/agents/taskpilot-tester.md"), "utf8")).toContain("name: taskpilot-tester");
    expect(await get("/api/backups")).toHaveLength(4);
    expect((await byName("taskpilot-implementer")).check.template).toBe("same");

    // Unchanged files are skipped, not rewritten.
    const again = (await send("POST", "/api/config/agents/templates/install", {})).json();
    expect(again).toMatchObject({ files: [], skipped: expect.arrayContaining([".claude/agents/taskpilot-explorer.md"]) });

    // An edited file: 409 until it is named in `overwrite` with the hash from the preview.
    const file = path.join(repo, ".claude/agents/taskpilot-reviewer.md");
    await writeFile(file, agent("name: taskpilot-reviewer\ndescription: Mine\ntools: Read"));
    expect((await byName("taskpilot-reviewer")).check.template).toBe("modified");
    const clash = await send("POST", "/api/config/agents/templates/install", { names: ["taskpilot-reviewer"] });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toContain("taskpilot-reviewer.md");
    const stale = await send("POST", "/api/config/agents/templates/install", { names: ["taskpilot-reviewer"], overwrite: ["taskpilot-reviewer"], hashes: {} });
    expect(stale.statusCode).toBe(409);
    const { files } = (await send("POST", "/api/config/agents/templates/preview", { names: ["taskpilot-reviewer"] })).json();
    expect(files[0]).toMatchObject({ exists: true, same: false });
    const ok = await send("POST", "/api/config/agents/templates/install", {
      names: ["taskpilot-reviewer"],
      overwrite: ["taskpilot-reviewer"],
      hashes: { "taskpilot-reviewer": files[0].hash },
    });
    expect(ok.statusCode).toBe(200);
    expect(await readFile(file, "utf8")).toContain("model: opus");
    expect((await get("/api/backups"))[0]).toMatchObject({ existed: true, display: ".claude/agents/taskpilot-reviewer.md" });
  });

  it("refuses unknown templates and a name already used by another file", async () => {
    expect((await send("POST", "/api/config/agents/templates/install", { names: ["nope"] })).statusCode).toBe(400);
    await mkdir(path.join(repo, ".claude/agents/team"), { recursive: true });
    await writeFile(path.join(repo, ".claude/agents/team/explorer.md"), agent("name: taskpilot-explorer\ndescription: Ours"));
    const res = await send("POST", "/api/config/agents/templates/install", { names: ["taskpilot-explorer"], overwrite: ["taskpilot-explorer"] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("team/explorer.md");
  });
});
