import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { get, home, send, useConfigApp } from "../../helpers/configApp.js";

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
