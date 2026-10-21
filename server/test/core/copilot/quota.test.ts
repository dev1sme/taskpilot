import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copilotQuota } from "../../../src/core/copilot/quota.js";
import { cleanupTempDirs, tempDir } from "../../helpers/fixtures.js";

afterAll(cleanupTempDirs);

const SNAPSHOTS = { premium_interactions: { isUnlimitedEntitlement: false, remainingPercentage: 90 } };

/**
 * Fake `copilot --headless --stdio`: records its args and pid, reads one framed request and answers
 * it with `reply` (a JSON-RPC message without id), or never answers when `reply` is null.
 */
async function fakeCopilot(reply: Record<string, unknown> | null): Promise<{ file: string; record: string }> {
  const dir = await tempDir("taskpilot-fake-copilot-");
  const file = path.join(dir, "copilot.cjs");
  const record = path.join(dir, "record.json");
  await writeFile(
    file,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), pid: process.pid }));
const reply = ${JSON.stringify(reply)};
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  const end = buf.indexOf("\\r\\n\\r\\n");
  if (end < 0 || !reply) return;
  const req = JSON.parse(buf.slice(end + 4));
  const body = JSON.stringify({ jsonrpc: "2.0", id: req.id, ...reply });
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
});
setInterval(() => {}, 1000);
`,
  );
  await chmod(file, 0o755);
  return { file, record };
}

async function recorded(record: string): Promise<{ args: string[]; pid: number }> {
  return JSON.parse(await readFile(record, "utf8")) as { args: string[]; pid: number };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("copilotQuota", () => {
  it("returns the quota snapshots, stops the runtime and removes its log directory", async () => {
    const fake = await fakeCopilot({ result: { quotaSnapshots: SNAPSHOTS } });
    expect(await copilotQuota({ file: fake.file })).toEqual({ ok: true, snapshots: SNAPSHOTS });
    const { args, pid } = await recorded(fake.record);
    expect(args).toEqual(expect.arrayContaining(["--headless", "--no-auto-update", "--stdio", "--log-dir"]));
    expect(existsSync(args[args.indexOf("--log-dir") + 1])).toBe(false);
    expect(alive(pid)).toBe(false);
  });

  it("tells a logged-out user apart from other errors", async () => {
    const loggedOut = await fakeCopilot({ error: { code: -32603, message: "Request account.getQuota failed with message: Not authenticated. Please authenticate first." } });
    expect(await copilotQuota({ file: loggedOut.file })).toEqual({ ok: false, reason: "unauthenticated" });
    const broken = await fakeCopilot({ error: { code: -32601, message: "Unhandled method account.getQuota" } });
    expect(await copilotQuota({ file: broken.file })).toEqual({ ok: false, reason: "failed" });
  });

  it("reports a missing binary", async () => {
    const dir = await tempDir("taskpilot-no-copilot-");
    expect(await copilotQuota({ file: path.join(dir, "copilot") })).toEqual({ ok: false, reason: "missing" });
  });

  it("gives up on a runtime that never answers and kills it", async () => {
    const fake = await fakeCopilot(null);
    expect(await copilotQuota({ file: fake.file, timeoutMs: 500 })).toEqual({ ok: false, reason: "failed" });
    expect(alive((await recorded(fake.record)).pid)).toBe(false);
  });
});
