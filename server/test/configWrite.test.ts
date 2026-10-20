import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { isAllowedPath } from "../src/modules/config/shared/targets.js";
import { StateStore } from "../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };
const saved = { ...process.env };

let app: FastifyInstance;
let repo: string;
let home: string;

beforeEach(async () => {
  repo = await makeRepo();
  home = await tempDir("taskpilot-home-");
  process.env.TASKPILOT_CLAUDE_HOME = home;
  process.env.TASKPILOT_CLAUDE_JSON = path.join(home, "claude.json");
  app = await buildApp({ token: TOKEN, state: new StateStore(await tempDir("taskpilot-state-")), repo });
});
afterEach(async () => app.close());
afterAll(async () => {
  process.env = saved;
  await cleanupTempDirs();
});

const get = async (url: string) => (await app.inject({ url, headers: ok })).json();
const send = (method: "POST" | "PUT", url: string, payload: object) => app.inject({ method, url, headers: ok, payload });

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

describe("permission editing", () => {
  const settingsFile = () => path.join(repo, ".claude", "settings.json");

  beforeEach(async () => {
    await writeFile(
      settingsFile(),
      JSON.stringify({ env: { API_TOKEN: "s3cret" }, permissions: { allow: ["Read"], additionalDirectories: ["../x"] }, hooks: { Stop: [] } }),
    );
  });

  it("replaces rules and mode, keeps every other key, never shows secrets in the diff", async () => {
    const before = await get("/api/config/settings/project/permissions");
    expect(before).toMatchObject({ exists: true, allow: ["Read"], deny: [], defaultMode: null });

    const body = { allow: ["Read", " Bash(npm test) ", "Read"], ask: [], deny: ["Bash(rm *)"], defaultMode: "acceptEdits", baseHash: before.hash };
    const preview = (await send("POST", "/api/config/settings/project/permissions/preview", body)).json();
    expect(preview.diff).toContain('+      "Bash(npm test)"');
    expect(preview.diff).not.toContain("s3cret");

    expect((await send("PUT", "/api/config/settings/project/permissions", body)).statusCode).toBe(200);
    const written = JSON.parse(await readFile(settingsFile(), "utf8"));
    expect(written).toEqual({
      env: { API_TOKEN: "s3cret" },
      permissions: { allow: ["Read", "Bash(npm test)"], additionalDirectories: ["../x"], deny: ["Bash(rm *)"], defaultMode: "acceptEdits" },
      hooks: { Stop: [] },
    });
  });

  it.each([
    [{ allow: ["rm -rf /"], ask: [], deny: [], defaultMode: null }, 400],
    [{ allow: [], ask: [], deny: [], defaultMode: "bypassPermissions" }, 400],
    [{ allow: "Read", ask: [], deny: [], defaultMode: null }, 400],
  ])("rejects invalid input %#", async (input, status) => {
    const before = await get("/api/config/settings/project/permissions");
    expect((await send("PUT", "/api/config/settings/project/permissions", { ...input, baseHash: before.hash })).statusCode).toBe(status);
  });

  it("refuses to edit a settings file that is not valid JSON", async () => {
    await writeFile(settingsFile(), "{ broken");
    expect((await app.inject({ url: "/api/config/settings/project/permissions", headers: ok })).statusCode).toBe(409);
  });
});

describe("backups", () => {
  it("lists, diffs and restores, backing up the current content first", async () => {
    await send("PUT", "/api/config/memory/project", { content: "v1\n", baseHash: "absent" });
    const v1 = await get("/api/config/memory/project/raw");
    await send("PUT", "/api/config/memory/project", { content: "v2\n", baseHash: v1.hash });

    const list = await get("/api/backups");
    expect(list.map((b: { existed: boolean }) => b.existed)).toEqual([true, false]);
    const [ofV1] = list;
    expect((await get(`/api/backups/${ofV1.id}/diff`)).diff).toContain("+v1");

    expect((await send("POST", `/api/backups/${ofV1.id}/restore`, {})).statusCode).toBe(200);
    expect(await readFile(path.join(repo, "CLAUDE.md"), "utf8")).toBe("v1\n");
    expect((await get("/api/backups"))[0].reason).toMatch(/Trước khi khôi phục/);

    // Restoring the "did not exist" backup removes the file (its content was just backed up).
    await send("POST", `/api/backups/${list[1].id}/restore`, {});
    await expect(readFile(path.join(repo, "CLAUDE.md"), "utf8")).rejects.toThrow();
  });

  it("rejects malformed backup ids", async () => {
    expect((await send("POST", "/api/backups/..%2F..%2Fetc/restore", {})).statusCode).toBe(400);
  });
});

describe("isAllowedPath", () => {
  it("allows only Claude config files", () => {
    expect(isAllowedPath(path.join(repo, "CLAUDE.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "a.md"), repo)).toBe(true);
    expect(isAllowedPath(path.join(home, "skills", "x", "run.sh"), repo)).toBe(true);
    expect(isAllowedPath(path.join(repo, ".claude", "agents"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, "src", "index.ts"), repo)).toBe(false);
    expect(isAllowedPath(path.join(repo, ".claude", "agents", "..", "..", "package.json"), repo)).toBe(false);
    expect(isAllowedPath("/etc/passwd", repo)).toBe(false);
  });
});
