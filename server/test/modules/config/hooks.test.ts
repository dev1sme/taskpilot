import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("hooks editing", () => {
  const settings = () => path.join(repo, ".claude", "settings.json");

  it("replaces command hooks, keeps other hook types and keys", async () => {
    await writeFile(
      settings(),
      JSON.stringify({
        env: { K: "secret-env" },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "old" }, { type: "prompt", prompt: "keep me" }] }] },
      }),
    );
    const before = await get("/api/config/settings/project/hooks");
    expect(before.hooks).toEqual([{ event: "Stop", matcher: "", command: "old" }]);
    // raw is the "hooks" value as written, prompt hooks included, and nothing else from the file.
    expect(before.raw).toEqual({ Stop: [{ hooks: [{ type: "command", command: "old" }, { type: "prompt", prompt: "keep me" }] }] });

    const body = {
      hooks: [
        { event: "PostToolUse", matcher: "Edit|Write", command: "npx prettier -w", timeout: 30 },
        { event: "Stop", matcher: "", command: "notify-send done" },
      ],
      baseHash: before.hash,
    };
    const preview = (await send("POST", "/api/config/settings/project/hooks/preview", body)).json();
    expect(preview.diff).toContain("npx prettier -w");
    expect(preview.diff).not.toContain("secret-env");

    expect((await send("PUT", "/api/config/settings/project/hooks", body)).statusCode).toBe(200);
    const written = JSON.parse(await readFile(settings(), "utf8"));
    expect(written.env).toEqual({ K: "secret-env" });
    expect(written.hooks).toEqual({
      PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier -w", timeout: 30 }] }],
      Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }, { hooks: [{ type: "prompt", prompt: "keep me" }] }],
    });
  });

  it.each([
    [{ event: "not an event", matcher: "", command: "x" }],
    [{ event: "Stop", matcher: "", command: "a\nb" }],
    [{ event: "Stop", matcher: "", command: "x", timeout: 0 }],
  ])("rejects invalid hook %#", async (hook) => {
    const before = await get("/api/config/settings/project/hooks");
    expect((await send("PUT", "/api/config/settings/project/hooks", { hooks: [hook], baseHash: before.hash })).statusCode).toBe(400);
  });
});
