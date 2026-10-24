import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexHome, copilotHome, get, home, repo, send, useConfigApp } from "../../helpers/configApp.js";
import { checkCodexAgent } from "../../../src/modules/config/library/check.js";
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
    ["agents", "a//b.md"],
    ["agents", "./x.md"],
    ["agents", "a/../x.md"],
    ["agents", "/abs.md"],
    ["agents", "a\\b.md"],
    ["agents", ".md/x"],
    ["skills", "deploy/run.sh"],
    ["commands", "a/../x.md"],
    ["commands", "a//b.md"],
  ])("rejects %s path %s", async (kind, rel) => {
    expect((await send("PUT", `/api/config/library/${kind}/project`, { rel, content: "x", baseHash: "absent" })).statusCode).toBe(400);
  });

  it.each([
    ["agents", "code.reviewer.md"],
    ["agents", "Agent Name.md"],
    ["agents", "a/b/c/d.md"],
    ["commands", "a/b/c/d.md"],
    ["commands", "git/v1.2/pr.md"],
  ])("accepts, edits and deletes %s path %s", async (kind, rel) => {
    const put = (content: string, baseHash: string) => send("PUT", `/api/config/library/${kind}/project`, { rel, content, baseHash });
    expect((await put("one\n", "absent")).statusCode).toBe(200);
    const raw = await get(`/api/config/library/${kind}/project/raw?rel=${encodeURIComponent(rel)}`);
    expect((await put("two\n", raw.hash)).statusCode).toBe(200);
    const raw2 = await get(`/api/config/library/${kind}/project/raw?rel=${encodeURIComponent(rel)}`);
    const del = await send("DELETE", `/api/config/library/${kind}/project?rel=${encodeURIComponent(rel)}&baseHash=${raw2.hash}`);
    expect(del.statusCode).toBe(200);
  });
});

describe("directory symlink loops", () => {
  it("lists each command once when a directory links back to itself", async () => {
    const dir = path.join(repo, ".claude", "commands");
    await mkdir(path.join(dir, "git"), { recursive: true });
    await writeFile(path.join(dir, "top.md"), "Top\n");
    await writeFile(path.join(dir, "git", "pr.md"), "PR\n");
    await symlink(".", path.join(dir, "self"));
    await symlink("..", path.join(dir, "git", "up"));
    const names = (await get("/api/config/commands")).map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["git:pr", "top"]);
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

describe("Codex subagent templates", () => {
  it("ships four TOML templates that pass the check", async () => {
    const list = await get("/api/config/agents/templates?cli=codex");
    expect(list.map((x: { name: string }) => x.name)).toEqual(TEMPLATES);
    for (const x of list) expect(x.check.status).toBe("ok");
    expect(list.find((x: { name: string }) => x.name === "taskpilot-explorer").check.roles).toEqual(["leader"]);
  });

  it("installs to .codex/agents with backups, skips equal files and refuses silent overwrite", async () => {
    const preview = (await send("POST", "/api/config/agents/templates/preview", { cli: "codex" })).json();
    expect(preview.files).toHaveLength(4);
    expect(preview.diff).toContain('+name = "taskpilot-explorer"');

    const res = await send("POST", "/api/config/agents/templates/install", { cli: "codex", names: TEMPLATES });
    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual(TEMPLATES.map((n) => `.codex/agents/${n}.toml`));
    expect(await readFile(path.join(repo, ".codex/agents/taskpilot-tester.toml"), "utf8")).toContain('name = "taskpilot-tester"');
    expect(await get("/api/backups")).toHaveLength(4);
    expect((await get("/api/config/agents/templates")).every((x: { exists: boolean }) => !x.exists)).toBe(true);
    expect((await get("/api/config/agents/templates?cli=codex")).every((x: { same: boolean }) => x.same)).toBe(true);

    const again = (await send("POST", "/api/config/agents/templates/install", { cli: "codex" })).json();
    expect(again.files).toEqual([]);

    await writeFile(path.join(repo, ".codex/agents/taskpilot-reviewer.toml"), 'name = "taskpilot-reviewer"\n');
    const clash = await send("POST", "/api/config/agents/templates/install", { cli: "codex", names: ["taskpilot-reviewer"] });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toContain(".codex/agents/taskpilot-reviewer.toml");
  });

  it("refuses an unknown cli and a name already declared by another file", async () => {
    expect((await send("POST", "/api/config/agents/templates/install", { cli: "gemini" })).statusCode).toBe(400);
    await mkdir(path.join(repo, ".codex/agents"), { recursive: true });
    await writeFile(path.join(repo, ".codex/agents/mine.toml"), 'name = "taskpilot-explorer"\ndescription = "x"\ndeveloper_instructions = "x"\n');
    const res = await send("POST", "/api/config/agents/templates/install", { cli: "codex", names: ["taskpilot-explorer"] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("mine.toml");
  });

  it("checks a Codex agent file", () => {
    expect(checkCodexAgent("name = ").status).toBe("error");
    expect(checkCodexAgent('name = "a"\ndescription = "b"').problems).toHaveLength(1);
    expect(checkCodexAgent('name = "a"\ndescription = "b"\ndeveloper_instructions = "c"\nsandbox_mode = "x"').status).toBe("error");
    expect(checkCodexAgent('name = "a"\ndescription = "b"\ndeveloper_instructions = "c"').roles).toEqual(["leader", "member"]);
  });
});

describe("native CLI libraries", () => {
  it("lists Codex TOML agents and supports preview, CRUD, backup and template comparison", async () => {
    const url = "/api/config/library/agents/project?cli=codex";
    const content = 'name = "taskpilot-reviewer"\ndescription = "Reviews"\ndeveloper_instructions = "Review changes"\n';
    const preview = (await send("POST", "/api/config/library/agents/project/preview?cli=codex", { rel: "taskpilot-reviewer.toml", content, baseHash: "absent" })).json();
    expect(preview).toMatchObject({ changed: true, stale: false });
    expect(preview.diff).toContain(".codex/agents/taskpilot-reviewer.toml");
    expect((await send("PUT", url, { rel: "taskpilot-reviewer.toml", content, baseHash: "absent" })).statusCode).toBe(200);
    const list = await get("/api/config/agents?cli=codex");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "taskpilot-reviewer",
      rel: "taskpilot-reviewer.toml",
      path: ".codex/agents/taskpilot-reviewer.toml",
      body: "Review changes",
      check: { status: "ok", template: "modified" },
    });
    expect(await get("/api/config/agents")).toEqual([]);
    const raw = await get("/api/config/library/agents/project/raw?cli=codex&rel=taskpilot-reviewer.toml");
    expect(raw.content).toBe(content);
    expect((await send("PUT", url, { rel: "taskpilot-reviewer.toml", content: content + "# edited\n", baseHash: "absent" })).statusCode).toBe(409);
    expect((await send("PUT", url, { rel: "taskpilot-reviewer.toml", content: content + "# edited\n", baseHash: raw.hash })).statusCode).toBe(200);
    const edited = await get("/api/config/library/agents/project/raw?cli=codex&rel=taskpilot-reviewer.toml");
    expect(edited.content).toContain("# edited");
    expect((await send("DELETE", `${url}&rel=taskpilot-reviewer.toml&baseHash=${edited.hash}`)).statusCode).toBe(200);
    expect(await get("/api/config/agents?cli=codex")).toEqual([]);
    expect((await get("/api/backups"))[0]).toMatchObject({ display: ".codex/agents/taskpilot-reviewer.toml", existed: true });

    const installed = await send("POST", "/api/config/agents/templates/install", { cli: "codex", names: ["taskpilot-reviewer"] });
    expect(installed.statusCode).toBe(200);
    expect((await get("/api/config/agents?cli=codex"))[0].check.template).toBe("same");
    expect(await readFile(path.join(repo, ".codex", "agents", "taskpilot-reviewer.toml"), "utf8")).toContain('name = "taskpilot-reviewer"');
  });

  it("lists Copilot's native and Claude-compatible agents without treating the latter as editable", async () => {
    await mkdir(path.join(repo, ".github", "agents"), { recursive: true });
    await mkdir(path.join(repo, ".claude", "agents"), { recursive: true });
    await mkdir(path.join(copilotHome, "agents"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "agents", "legacy.md"), agent("name: legacy\ndescription: Legacy"));
    await writeFile(path.join(repo, ".github", "agents", "helper.agent.md"), agent("description: Native"));
    await writeFile(path.join(copilotHome, "agents", "personal.agent.md"), agent("description: User"));
    const list = await get("/api/config/agents?cli=copilot");
    expect(list.map((a: { name: string; path: string; editable: boolean }) => ({ name: a.name, path: a.path, editable: a.editable }))).toEqual([
      { name: "helper", path: ".github/agents/helper.agent.md", editable: true },
      { name: "legacy", path: ".claude/agents/legacy.md", editable: false },
      { name: "personal", path: path.join(copilotHome, "agents", "personal.agent.md"), editable: true },
    ]);
    expect((await send("PUT", "/api/config/library/agents/project?cli=copilot", { rel: "legacy.md", content: "new", baseHash: "absent" })).statusCode).toBe(200);
    expect(await readFile(path.join(repo, ".claude", "agents", "legacy.md"), "utf8")).toContain("Legacy");
    expect(await readFile(path.join(repo, ".github", "agents", "legacy.md"), "utf8")).toBe("new");
    expect((await send("PUT", "/api/config/library/agents/user?cli=copilot", { rel: "wrong.md", content: "x", baseHash: "absent" })).statusCode).toBe(400);
  });

  it("uses native skill roots and rejects unsupported kinds, scopes and extensions", async () => {
    const skill = "---\nname: deploy\ndescription: Deploy\n---\nSteps\n";
    for (const [cli, scope, root] of [
      ["codex", "project", path.join(repo, ".agents", "skills")],
      ["codex", "user", path.join(codexHome, "skills")],
      ["copilot", "project", path.join(repo, ".github", "skills")],
      ["copilot", "user", path.join(copilotHome, "skills")],
    ]) {
      const url = `/api/config/library/skills/${scope}?cli=${cli}`;
      expect((await send("PUT", url, { rel: "deploy/SKILL.md", content: skill, baseHash: "absent" })).statusCode).toBe(200);
      expect(await readFile(path.join(root, "deploy", "SKILL.md"), "utf8")).toBe(skill);
      expect(
        (await get(`/api/config/skills?cli=${cli}`)).some(
          (a: { path: string }) => a.path === path.relative(repo, path.join(root, "deploy", "SKILL.md")) || a.path === path.join(root, "deploy", "SKILL.md"),
        ),
      ).toBe(true);
    }
    expect((await send("PUT", "/api/config/library/agents/project?cli=codex", { rel: "wrong.md", content: "x", baseHash: "absent" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/library/agents/project?cli=codex", { rel: "broken.toml", content: "name = ", baseHash: "absent" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/library/agents/user?cli=codex", { rel: "right.toml", content: "x", baseHash: "absent" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/library/skills/project?cli=copilot", { rel: "deploy/readme.md", content: "x", baseHash: "absent" })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/library/commands/project?cli=codex", { rel: "x.md", content: "x", baseHash: "absent" })).statusCode).toBe(501);
    expect((await get("/api/config/commands?cli=copilot")).error).toBeDefined();
    expect((await get("/api/config/capabilities?cli=codex")).sections.agents.available).toBe(true);
    expect((await get("/api/config/capabilities?cli=copilot")).sections.skills.available).toBe(true);
  });
});
