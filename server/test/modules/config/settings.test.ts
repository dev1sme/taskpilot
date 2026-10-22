import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { app, get, ok, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("permission editing", () => {
  const settingsFile = () => path.join(repo, ".claude", "settings.json");

  beforeEach(async () => {
    await writeFile(settingsFile(), JSON.stringify({ env: { API_TOKEN: "s3cret" }, permissions: { allow: ["Read"], additionalDirectories: ["../x"] }, hooks: { Stop: [] } }));
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

  it("previews no change when the file only differs in formatting", async () => {
    await writeFile(settingsFile(), JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { Stop: [] } }, null, 4));
    const before = await get("/api/config/settings/project/permissions");
    const body = { allow: ["Read"], ask: [], deny: [], defaultMode: null, baseHash: before.hash };
    const preview = (await send("POST", "/api/config/settings/project/permissions/preview", body)).json();
    expect(preview.changed).toBe(false);
  });

  it.each([
    [{ allow: ["rm -rf /"], ask: [], deny: [], defaultMode: null }, 400],
    [{ allow: [], ask: [], deny: [], defaultMode: "bypassPermissions" }, 400],
    [{ allow: "Read", ask: [], deny: [], defaultMode: null }, 400],
  ])("rejects invalid input %#", async (input, status) => {
    const before = await get("/api/config/settings/project/permissions");
    expect((await send("PUT", "/api/config/settings/project/permissions", { ...input, baseHash: before.hash })).statusCode).toBe(status);
  });

  describe("a mode that is not offered", () => {
    const body = (defaultMode: string | null, baseHash: string) => ({ allow: ["Read", "Bash(npm test)"], ask: [], deny: [], defaultMode, baseHash });

    beforeEach(async () => {
      await writeFile(settingsFile(), JSON.stringify({ permissions: { allow: ["Read"], defaultMode: "bypassPermissions" } }));
    });

    it("is accepted when the file already has it, and kept", async () => {
      const before = await get("/api/config/settings/project/permissions");
      expect(before.defaultMode).toBe("bypassPermissions");
      const preview = await send("POST", "/api/config/settings/project/permissions/preview", body("bypassPermissions", before.hash));
      expect(preview.statusCode).toBe(200);
      expect((await send("PUT", "/api/config/settings/project/permissions", body("bypassPermissions", before.hash))).statusCode).toBe(200);
      const written = JSON.parse(await readFile(settingsFile(), "utf8"));
      expect(written.permissions).toEqual({ allow: ["Read", "Bash(npm test)"], defaultMode: "bypassPermissions" });
    });

    it("can still be replaced by an offered mode", async () => {
      const before = await get("/api/config/settings/project/permissions");
      expect((await send("PUT", "/api/config/settings/project/permissions", body("plan", before.hash))).statusCode).toBe(200);
      expect(JSON.parse(await readFile(settingsFile(), "utf8")).permissions.defaultMode).toBe("plan");
    });

    it("is rejected when the file has another mode", async () => {
      await writeFile(settingsFile(), JSON.stringify({ permissions: { defaultMode: "plan" } }));
      const before = await get("/api/config/settings/project/permissions");
      expect((await send("PUT", "/api/config/settings/project/permissions", body("bypassPermissions", before.hash))).statusCode).toBe(400);
      expect((await send("POST", "/api/config/settings/project/permissions/preview", body("bypassPermissions", before.hash))).statusCode).toBe(400);
    });

    it("is rejected when the file has no mode, or a different unknown one", async () => {
      await writeFile(settingsFile(), JSON.stringify({ permissions: { defaultMode: "other" } }));
      const before = await get("/api/config/settings/project/permissions");
      expect((await send("PUT", "/api/config/settings/project/permissions", body("bypassPermissions", before.hash))).statusCode).toBe(400);
    });
  });

  it("refuses to edit a settings file that is not valid JSON", async () => {
    await writeFile(settingsFile(), "{ broken");
    expect((await app.inject({ url: "/api/config/settings/project/permissions", headers: ok })).statusCode).toBe(409);
  });
});
