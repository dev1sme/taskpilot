import type { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { statusLineCommand } from "../src/config/settings.js";
import type { Launcher } from "../src/core/claude/launch.js";
import { UsageStore } from "../src/sessions/usage.js";
import { StateStore } from "../src/core/state.js";
import { cleanupTempDirs, makeRepo, tempDir } from "./fixtures.js";

const TOKEN = "test-token";
const ok = { host: "127.0.0.1:8790", "x-taskpilot-token": TOKEN };
const saved = { ...process.env };

const RATE_LIMITS = {
  five_hour: { used_percentage: 85, resets_at: 1792477800 },
  seven_day: { used_percentage: 39, resets_at: 1792832400 },
};

/**
 * Stands in for claude: feeds status line input to the status line command TaskPilot passed in
 * --settings (the real relay script), prints what it printed, then idles.
 */
const statusLineClaude: Launcher = (id, { settings }) => {
  const command = (JSON.parse(settings) as { statusLine: { command: string } }).statusLine.command;
  const input = JSON.stringify({ session_id: id, rate_limits: RATE_LIMITS });
  return { file: "/bin/sh", args: ["-c", 'printf "%s" "$1" | sh -c "$2"; echo; echo done; cat', "sh", input, command] };
};

let app: FastifyInstance | undefined;
let home: string;
afterEach(async () => app?.close());
afterAll(async () => {
  process.env = saved;
  await cleanupTempDirs();
});

beforeAll(async () => {
  home = await tempDir("taskpilot-home-");
  process.env.TASKPILOT_CLAUDE_HOME = home;
});

async function waitFor<T>(read: () => Promise<T>, pred: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`timeout; last value ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("status line relay", () => {
  it("reports plan usage to TaskPilot and still runs the user's status line", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "echo user-line" } }));
    const state = new StateStore(await tempDir("taskpilot-state-"));
    app = await buildApp({ token: TOKEN, state, repo, launcher: statusLineClaude });
    await app.listen({ host: "127.0.0.1", port: 0 });
    expect((await app.inject({ url: "/api/usage", headers: ok })).json()).toBeNull();

    const s = (await app.inject({ method: "POST", url: "/api/repo/sessions", headers: ok })).json();
    const usage = await waitFor(
      async () => (await app!.inject({ url: "/api/usage", headers: ok })).json(),
      (v) => v !== null,
    );
    expect(usage).toMatchObject({
      fiveHour: { usedPercentage: 85, resetsAt: 1792477800_000 },
      sevenDay: { usedPercentage: 39, resetsAt: 1792832400_000 },
    });
    expect((await state.load()).usage).toEqual(usage);

    // The terminal still shows the user's own status line.
    const ws = await app.injectWS(`/api/sessions/${s.id}/pty`, { headers: ok });
    let output = "";
    ws.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { t: string; d?: string };
      if (frame.t === "o") output += frame.d;
    });
    ws.send(JSON.stringify({ t: "r", cols: 80, rows: 24 }));
    await waitFor(async () => output, (o) => o.includes("done"));
    expect(output).toContain("user-line");
    ws.close();
    await app.inject({ method: "POST", url: `/api/sessions/${s.id}/stop`, headers: ok });
  });

  it("refuses an unknown hook token", async () => {
    const state = new StateStore(await tempDir("taskpilot-state-"));
    app = await buildApp({ token: TOKEN, state, repo: await makeRepo(), launcher: statusLineClaude });
    const res = await app.inject({
      method: "POST",
      url: "/hook/statusline",
      headers: { host: ok.host, "x-taskpilot-hook-token": "nope" },
      payload: { rate_limits: RATE_LIMITS },
    });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ url: "/api/usage", headers: ok })).json()).toBeNull();
    expect((await app.inject({ url: "/api/usage", headers: { host: ok.host } })).statusCode).toBe(401);
  });
});

describe("statusLineCommand", () => {
  it("prefers local, then project, then user settings", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "user" } }));
    expect(await statusLineCommand(repo)).toBe("user");
    await mkdir(path.join(repo, ".claude"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "project" } }));
    expect(await statusLineCommand(repo)).toBe("project");
    await writeFile(path.join(repo, ".claude", "settings.local.json"), JSON.stringify({ statusLine: { type: "command", command: "local" } }));
    expect(await statusLineCommand(repo)).toBe("local");
  });

  it("returns null without a command status line", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(home, "settings.json"), JSON.stringify({ statusLine: { type: "static" } }));
    expect(await statusLineCommand(repo)).toBeNull();
  });
});

describe("UsageStore", () => {
  it("keeps the last numbers when input has no rate limits, and ignores bad values", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({});
    await store.apply({ rate_limits: { five_hour: { used_percentage: "90" }, seven_day: { used_percentage: 140 } } });
    expect(await store.view()).toMatchObject({ fiveHour: { usedPercentage: 85 }, sevenDay: { usedPercentage: 39 } });
  });

  it("publishes only when the numbers change", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    const seen: number[] = [];
    store.on("change", (u) => seen.push(u.fiveHour!.usedPercentage));
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({ rate_limits: RATE_LIMITS });
    await store.apply({ rate_limits: { ...RATE_LIMITS, five_hour: { used_percentage: 86, resets_at: 1792477800 } } });
    expect(seen).toEqual([85, 86]);
  });

  it("reads gateway spend", async () => {
    const store = new UsageStore(new StateStore(await tempDir("taskpilot-state-")));
    await store.apply({ rate_limits: { spend_limit: { used_percentage: 63 } } });
    expect(await store.view()).toMatchObject({ spend: { usedPercentage: 63 } });
  });
});
