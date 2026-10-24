import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../helpers/fixtures.js";
import { app, codexHome, copilotHome, get, home, ok, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("CLAUDE.md editing", () => {
  it("creates, previews, updates with a backup, and refuses stale writes", async () => {
    const raw = await get("/api/config/memory/project/raw");
    expect(raw).toMatchObject({ exists: false, hash: "absent" });

    const created = await send("PUT", "/api/config/memory/project", { content: "# Repo\n", baseHash: raw.hash });
    expect(created.statusCode).toBe(200);
    expect(created.json().backup).toMatchObject({ existed: false, display: "CLAUDE.md" });
    expect(await readFile(path.join(repo, "CLAUDE.md"), "utf8")).toBe("# Repo\n");

    const preview = (await send("POST", "/api/config/memory/project/preview", { content: "# Repo\n\n## Git\n", baseHash: created.json().hash })).json();
    expect(preview).toMatchObject({ changed: true, stale: false });
    expect(preview.diff).toContain("+## Git");

    // Someone edits the file outside TaskPilot: the old hash is now stale.
    await writeFile(path.join(repo, "CLAUDE.md"), "# Edited elsewhere\n");
    const stale = await send("PUT", "/api/config/memory/project", { content: "# Mine\n", baseHash: created.json().hash });
    expect(stale.statusCode).toBe(409);
    expect(await readFile(path.join(repo, "CLAUDE.md"), "utf8")).toBe("# Edited elsewhere\n");

    const fresh = await get("/api/config/memory/project/raw");
    const updated = await send("PUT", "/api/config/memory/project", { content: "# Mine\n", baseHash: fresh.hash });
    expect(updated.json().backup).toMatchObject({ existed: true, bytes: "# Edited elsewhere\n".length });
  });

  it("writes the global file under the Claude home", async () => {
    await send("PUT", "/api/config/memory/user", { content: "# Global\n", baseHash: "absent" });
    expect(await readFile(path.join(home, "CLAUDE.md"), "utf8")).toBe("# Global\n");
  });

  it("refuses to write through a symlink", async () => {
    const outside = path.join(await tempDir("taskpilot-outside-"), "target.md");
    await writeFile(outside, "x");
    await symlink(outside, path.join(repo, "CLAUDE.local.md"));
    const raw = await get("/api/config/memory/local/raw");
    const res = await send("PUT", "/api/config/memory/local", { content: "pwned", baseHash: raw.hash });
    expect(res.statusCode).toBe(409);
    expect(await readFile(outside, "utf8")).toBe("x");
  });

  it("rejects unknown scopes", async () => {
    expect((await app.inject({ url: "/api/config/memory/etc/raw", headers: ok })).statusCode).toBe(400);
  });
});

describe.each([
  { cli: "codex", project: "AGENTS.md", user: "AGENTS.md", home: () => codexHome },
  { cli: "copilot", project: ".github/copilot-instructions.md", user: "copilot-instructions.md", home: () => copilotHome },
])("$cli instructions", ({ cli, project, user, home: cliHome }) => {
  it("reads only its native project and user files", async () => {
    await mkdir(path.dirname(path.join(repo, project)), { recursive: true });
    await writeFile(path.join(repo, project), `# ${cli} project\n`);
    await writeFile(path.join(cliHome(), user), `# ${cli} user\n`);
    await writeFile(path.join(repo, "CLAUDE.md"), "# Claude\n");

    const files = await get(`/api/config/memory?cli=${cli}`);
    expect(files).toHaveLength(2);
    expect(files.map((file: { scope: string }) => file.scope)).toEqual(["project", "user"]);
    expect(files[0]).toMatchObject({ path: project, content: `# ${cli} project\n`, exists: true });
    expect(files[1]).toMatchObject({ path: path.join(cliHome(), user), content: `# ${cli} user\n`, exists: true });
    expect((await get("/api/config/memory"))[0].content).toBe("# Claude\n");
    expect((await get(`/api/config/capabilities?cli=${cli}`)).sections.memory).toMatchObject({ available: true, scopes: ["project", "user"] });
  });

  it("previews, saves, backs up, and refuses a stale project edit", async () => {
    const url = `/api/config/memory/project?cli=${cli}`;
    const raw = await get(`/api/config/memory/project/raw?cli=${cli}`);
    expect(raw).toMatchObject({ path: project, exists: false, hash: "absent" });

    const preview = (await send("POST", `/api/config/memory/project/preview?cli=${cli}`, { content: "# New\n", baseHash: raw.hash })).json();
    expect(preview).toMatchObject({ changed: true, stale: false });
    expect(preview.diff).toContain("+# New");

    const created = await send("PUT", url, { content: "# New\n", baseHash: raw.hash });
    expect(created.statusCode).toBe(200);
    expect(created.json().backup).toMatchObject({ existed: false, display: project });
    expect(await readFile(path.join(repo, project), "utf8")).toBe("# New\n");

    const stale = await send("PUT", url, { content: "# Stale\n", baseHash: raw.hash });
    expect(stale.statusCode).toBe(409);
    expect(await readFile(path.join(repo, project), "utf8")).toBe("# New\n");

    const fresh = await get(`/api/config/memory/project/raw?cli=${cli}`);
    const updated = await send("PUT", url, { content: "# Updated\n", baseHash: fresh.hash });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().backup).toMatchObject({ existed: true, bytes: "# New\n".length, display: project });
    expect(await readFile(path.join(repo, project), "utf8")).toBe("# Updated\n");
  });

  it("writes the user file in the CLI home", async () => {
    const raw = await get(`/api/config/memory/user/raw?cli=${cli}`);
    const saved = await send("PUT", `/api/config/memory/user?cli=${cli}`, { content: "# User\n", baseHash: raw.hash });
    expect(saved.statusCode).toBe(200);
    expect(await readFile(path.join(cliHome(), user), "utf8")).toBe("# User\n");
  });

  it("rejects local scope on raw, preview, and save", async () => {
    const raw = await app.inject({ url: `/api/config/memory/local/raw?cli=${cli}`, headers: ok });
    const preview = await send("POST", `/api/config/memory/local/preview?cli=${cli}`, { content: "x", baseHash: "absent" });
    const save = await send("PUT", `/api/config/memory/local?cli=${cli}`, { content: "x", baseHash: "absent" });
    expect([raw.statusCode, preview.statusCode, save.statusCode]).toEqual([400, 400, 400]);
  });
});

it("rejects an unknown CLI on every memory endpoint", async () => {
  expect((await app.inject({ url: "/api/config/memory?cli=unknown", headers: ok })).statusCode).toBe(400);
  expect((await app.inject({ url: "/api/config/memory/project/raw?cli=unknown", headers: ok })).statusCode).toBe(400);
  expect((await send("POST", "/api/config/memory/project/preview?cli=unknown", { content: "x", baseHash: "absent" })).statusCode).toBe(400);
  expect((await send("PUT", "/api/config/memory/project?cli=unknown", { content: "x", baseHash: "absent" })).statusCode).toBe(400);
});

describe("project memory and linked folders", () => {
  it("uses .claude/CLAUDE.md when it is the only one, warns when both exist", async () => {
    const dotClaude = path.join(repo, ".claude", "CLAUDE.md");
    await writeFile(dotClaude, "# Dot\n");
    expect((await get("/api/config/memory"))[0]).toMatchObject({ exists: true, content: "# Dot\n" });

    await writeFile(path.join(repo, "CLAUDE.md"), "# Root\n");
    const [project] = await get("/api/config/memory");
    expect(project.content).toBe("# Root\n");
    expect(project.checks[0]).toMatchObject({ level: "warn", message: expect.stringContaining(".claude/CLAUDE.md") });
  });

  it("lists nested and symlinked agents and skills, refuses to write through a link", async () => {
    await mkdir(path.join(repo, ".claude", "agents", "team"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "agents", "team", "qa.md"), "---\nname: qa\ndescription: Tests\n---\n");
    expect((await get("/api/config/agents")).map((a: { name: string }) => a.name)).toEqual(["qa"]);

    const shared = await tempDir("taskpilot-shared-");
    await mkdir(path.join(shared, "deploy"));
    await writeFile(path.join(shared, "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship\n---\n");
    await mkdir(path.join(repo, ".claude", "skills"), { recursive: true });
    await symlink(path.join(shared, "deploy"), path.join(repo, ".claude", "skills", "deploy"));
    expect((await get("/api/config/skills")).map((s: { name: string }) => s.name)).toContain("deploy");

    const raw = await get("/api/config/library/skills/project/raw?rel=deploy/SKILL.md");
    const put = await send("PUT", "/api/config/library/skills/project", { rel: "deploy/SKILL.md", content: "x", baseHash: raw.hash });
    expect(put.statusCode).toBe(409);
    expect(await readFile(path.join(shared, "deploy", "SKILL.md"), "utf8")).toContain("Ship");
  });
});
