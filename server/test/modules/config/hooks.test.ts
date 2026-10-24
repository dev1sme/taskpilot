import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copilotHome, get, repo, send, useConfigApp } from "../../helpers/configApp.js";

useConfigApp();

describe("hooks editing", () => {
  const settings = () => path.join(repo, ".claude", "settings.json");

  it("replaces command hooks, keeps other hook types and keys", async () => {
    await writeFile(
      settings(),
      JSON.stringify({
        env: { K: "secret-env" },
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "old" },
                { type: "prompt", prompt: "keep me" },
              ],
            },
          ],
        },
      }),
    );
    const before = await get("/api/config/settings/project/hooks");
    expect(before.hooks).toEqual([{ event: "Stop", matcher: "", command: "old" }]);
    // raw is the "hooks" value as written, prompt hooks included, and nothing else from the file.
    expect(before.raw).toEqual({
      Stop: [
        {
          hooks: [
            { type: "command", command: "old" },
            { type: "prompt", prompt: "keep me" },
          ],
        },
      ],
    });

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

  it("keeps hooks it cannot read on save (no type, or no command)", async () => {
    const untouched = [{ prompt: "no type field" }, { type: "command" }];
    await writeFile(settings(), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "old" }, ...untouched] }] } }));
    const before = await get("/api/config/settings/project/hooks");
    expect(before.hooks).toEqual([{ event: "Stop", matcher: "", command: "old" }]);

    expect((await send("PUT", "/api/config/settings/project/hooks", { hooks: [], baseHash: before.hash })).statusCode).toBe(200);
    const written = JSON.parse(await readFile(settings(), "utf8"));
    expect(written.hooks).toEqual({ Stop: [{ hooks: untouched }] });
  });

  it.each([[{ event: "not an event", matcher: "", command: "x" }], [{ event: "Stop", matcher: "", command: "a\nb" }], [{ event: "Stop", matcher: "", command: "x", timeout: 0 }]])(
    "rejects invalid hook %#",
    async (hook) => {
      const before = await get("/api/config/settings/project/hooks");
      expect((await send("PUT", "/api/config/settings/project/hooks", { hooks: [hook], baseHash: before.hash })).statusCode).toBe(400);
    },
  );
});

describe("Copilot native hooks", () => {
  const file = () => path.join(repo, ".github", "hooks", "custom.json");
  const url = "/api/config/hooks/project/custom.json?cli=copilot";

  it("reads, previews and saves version 1 command hooks while preserving other entries and private values", async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(
      file(),
      JSON.stringify({
        version: 1,
        note: "keep",
        hooks: {
          preToolUse: [
            { type: "command", bash: "echo old", timeoutSec: 10 },
            { type: "http", url: "https://example.com", headers: { Authorization: "secret-header" } },
            { type: "command", bash: "echo private", env: { TOKEN: "secret-env" } },
          ],
        },
      }),
    );
    const before = await get(url);
    expect(before.hooks).toEqual([{ event: "preToolUse", bash: "echo old", timeoutSec: 10 }]);
    expect(JSON.stringify(before)).not.toContain("secret-");
    const body = { baseHash: before.hash, hooks: [{ event: "postToolUse", matcher: "edit|create", exec: "node", args: ["check.js"], timeoutSec: 20 }] };
    const preview = (await send("POST", "/api/config/hooks/project/custom.json/preview?cli=copilot", body)).json();
    expect(preview.diff).toContain("check.js");
    expect(preview.diff).not.toContain("secret-");
    expect((await send("PUT", url, body)).statusCode).toBe(200);
    const written = JSON.parse(await readFile(file(), "utf8"));
    expect(written.version).toBe(1);
    expect(written.note).toBe("keep");
    expect(written.hooks.preToolUse).toHaveLength(2);
    expect(written.hooks.preToolUse[0].headers.Authorization).toBe("secret-header");
    expect(written.hooks.preToolUse[1].env.TOKEN).toBe("secret-env");
    expect(written.hooks.postToolUse).toEqual([{ type: "command", matcher: "edit|create", exec: "node", args: ["check.js"], timeoutSec: 20 }]);
    expect((await get("/api/config/hooks?cli=copilot")).some((item: { name: string }) => item.name === "custom.json")).toBe(true);
    expect((await get("/api/config/capabilities?cli=copilot")).sections.hooks.available).toBe(true);
    expect((await send("PUT", url, body)).statusCode).toBe(409);
  });

  it("supports user hook files and rejects unsupported scopes, reserved files and Claude payloads", async () => {
    const userFile = path.join(copilotHome, "hooks", "personal.json");
    await mkdir(path.dirname(userFile), { recursive: true });
    const userUrl = "/api/config/hooks/user/personal.json?cli=copilot";
    const before = await get(userUrl);
    expect(before.hash).toBe("absent");
    expect((await send("PUT", userUrl, { baseHash: before.hash, hooks: [{ event: "sessionStart", command: "echo hi" }] })).statusCode).toBe(200);
    expect(JSON.parse(await readFile(userFile, "utf8")).hooks.sessionStart[0].command).toBe("echo hi");
    expect((await send("PUT", "/api/config/hooks/local/personal.json?cli=copilot", { baseHash: "absent", hooks: [] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/hooks/user/taskpilot.json?cli=copilot", { baseHash: "absent", hooks: [] })).statusCode).toBe(403);
    expect((await send("PUT", "/api/config/settings/project/hooks?cli=copilot", { baseHash: "absent", hooks: [] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/config/settings/project/hooks?cli=codex", { baseHash: "absent", hooks: [] })).statusCode).toBe(501);
    expect((await get("/api/config/capabilities?cli=codex")).sections.hooks.reason).toMatch(/no verified native hooks adapter/);
  });

  it.each([
    [{ event: "NotAnEvent", command: "echo hi" }],
    [{ event: "preToolUse", matcher: "[", command: "echo hi" }],
    [{ event: "preToolUse", exec: "node", bash: "echo hi" }],
    [{ event: "sessionStart", command: "echo hi", timeoutSec: 0 }],
    [{ event: "sessionStart", command: "echo hi", env: { TOKEN: "x" } }],
  ])("rejects invalid Copilot schema %#", async (hook) => {
    expect((await send("PUT", url, { baseHash: "absent", hooks: [hook] })).statusCode).toBe(400);
  });

  it("does not overwrite a malformed Copilot hook file", async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), '{"version": 2, "hooks": {}}');
    expect((await send("PUT", url, { baseHash: (await get(url)).hash, hooks: [] })).statusCode).toBe(409);
    expect(await readFile(file(), "utf8")).toContain('"version": 2');
  });

  it("rejects hook file symlinks before reading or writing", async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    const outside = path.join(copilotHome, "outside.json");
    await writeFile(outside, JSON.stringify({ version: 1, hooks: {} }));
    await symlink(outside, file());
    expect((await send("PUT", url, { baseHash: "absent", hooks: [] })).statusCode).toBe(409);
    expect((await send("POST", "/api/config/hooks/project/custom.json/preview?cli=copilot", { baseHash: "absent", hooks: [] })).statusCode).toBe(409);
  });
});
