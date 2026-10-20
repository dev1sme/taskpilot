import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

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
