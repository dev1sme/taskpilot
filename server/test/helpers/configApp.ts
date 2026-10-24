import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { StateStore } from "../../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
export const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };
const saved = { ...process.env };

/**
 * Stands in for `claude mcp add-json|remove|get`, editing the fake ~/.claude.json. Like the real
 * `mcp get`, it prints environment values in clear, which TaskPilot must not pass on. An
 * `add-json` whose JSON contains `fail.invalid` exits 1 and changes nothing.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs");
const file = process.env.TASKPILOT_CLAUDE_JSON;
const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const [, , cmd, sub, ...rest] = process.argv;
if (cmd !== "mcp") process.exit(2);
const d = read();
const scopeIdx = rest.indexOf("--scope");
const scope = scopeIdx >= 0 ? rest[scopeIdx + 1] : "local";
const args = scopeIdx < 0 ? rest : rest.filter((_, i) => i !== scopeIdx && i !== scopeIdx + 1);
const holder = () => {
  if (scope === "user") return (d.mcpServers ??= {});
  d.projects ??= {};
  d.projects[process.cwd()] ??= {};
  return (d.projects[process.cwd()].mcpServers ??= {});
};
if (sub === "add-json") { if (args[1].includes("fail.invalid")) { console.error("invalid server config"); process.exit(1); } holder()[args[0]] = JSON.parse(args[1]); fs.writeFileSync(file, JSON.stringify(d)); console.log("Added"); }
else if (sub === "remove") { delete holder()[args[0]]; fs.writeFileSync(file, JSON.stringify(d)); console.log("Removed"); }
else if (sub === "get") {
  const s = (d.mcpServers ?? {})[args[0]] ?? (d.projects?.[process.cwd()]?.mcpServers ?? {})[args[0]];
  console.log(args[0] + ":\\n  Status: " + (process.env.GOOD_TOKEN ? "✔ Connected" : "✘ Failed to connect") + "\\n  Environment:\\n    SECRET=" + JSON.stringify(s?.env ?? {}));
}
`;

// Live bindings: test files import these and see the values of the current test.
export let app: FastifyInstance;
export let repo: string;
export let home: string;
export let codexHome: string;
export let copilotHome: string;
export let state: StateStore;

/** A fresh app on a fresh repo for every test, with ~/.claude, ~/.claude.json and claude faked. */
export function useConfigApp(): void {
  beforeEach(async () => {
    repo = await makeRepo();
    home = await tempDir("taskpilot-home-");
    codexHome = await tempDir("taskpilot-codex-home-");
    copilotHome = await tempDir("taskpilot-copilot-home-");
    process.env.TASKPILOT_CLAUDE_HOME = home;
    process.env.TASKPILOT_CODEX_HOME = codexHome;
    process.env.TASKPILOT_CODEX_SKILLS_HOME = path.join(codexHome, "skills");
    process.env.TASKPILOT_COPILOT_HOME = copilotHome;
    process.env.TASKPILOT_CLAUDE_JSON = path.join(home, "claude.json");
    const fake = path.join(home, "fake-claude.cjs");
    await writeFile(fake, FAKE_CLAUDE);
    await chmod(fake, 0o755);
    process.env.TASKPILOT_CLAUDE = fake;
    delete process.env.GOOD_TOKEN;
    state = new StateStore(await tempDir("taskpilot-state-"));
    app = await buildApp({ token: TOKEN, state, repo });
  });
  afterEach(async () => app.close());
  afterAll(async () => {
    process.env = saved;
    await cleanupTempDirs();
  });
}

export const get = async (url: string) => (await app.inject({ url, headers: ok })).json();
export const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object) => app.inject({ method, url, headers: ok, payload });
