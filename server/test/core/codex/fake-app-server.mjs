#!/usr/bin/env node
// Stands in for `codex` in tests: answers --version, and on stdio replays the handshake fixture's
// responses by method. FAKE_CODEX_COUNT_FILE gets a line per start; FAKE_CODEX_MODELS (JSON) replaces the model list;
// FAKE_CODEX_PAGES=1 splits it over two pages; FAKE_CODEX_FAIL=1 exits at once.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv[2] === "--version") {
  console.log("codex-cli 0.163.0");
  process.exit(0);
}
if (process.env.FAKE_CODEX_COUNT_FILE) appendFileSync(process.env.FAKE_CODEX_COUNT_FILE, `${process.argv.slice(2).join(" ")}\n`);
if (process.env.FAKE_CODEX_FAIL) {
  console.error("codex: boom");
  process.exit(3);
}

const fixture = readFileSync(new URL("../../fixtures/codex/handshake.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const sent = fixture.filter((l) => l.dir === "send" && l.msg.id !== undefined);
const answers = Object.fromEntries(sent.map((s) => [s.msg.method, fixture.find((l) => l.dir === "recv" && l.msg.id === s.msg.id).msg.result]));
if (process.env.FAKE_CODEX_MODELS) answers["model/list"] = { data: JSON.parse(process.env.FAKE_CODEX_MODELS), nextCursor: null };
if (process.env.FAKE_CODEX_LOGGED_OUT) answers["account/read"] = { account: null, requiresOpenaiAuth: true };
if (process.env.FAKE_CODEX_ACCOUNT_INVALID) answers["account/read"] = {};
if (process.env.FAKE_CODEX_PROTOCOL) answers.initialize = {};

// Synthetic read response (no recording of it); shape checked against generate-ts 0.163.0.
const snapshot = {
  limitId: "codex",
  primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1792684986 },
  secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1793248622 },
  credits: { hasCredits: false, unlimited: false, balance: "0" },
  planType: "plus",
  rateLimitReachedType: null,
};
answers["account/rateLimits/read"] = { rateLimits: snapshot, rateLimitsByLimitId: { codex: snapshot } };

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (process.env.FAKE_CODEX_PROBE_LOG)
    appendFileSync(
      process.env.FAKE_CODEX_PROBE_LOG,
      `${JSON.stringify({ method: msg.method, params: msg.params, cwd: process.cwd(), marker: process.env.PROBE_MARKER, uiToken: process.env.TASKPILOT_TOKEN, claudeEntry: process.env.CLAUDECODE, codexHome: process.env.CODEX_HOME, copilotAllowAll: process.env.COPILOT_ALLOW_ALL })}\n`,
    );
  if (msg.id === undefined) return;
  if (msg.method === process.env.FAKE_CODEX_HANG_METHOD) return;
  if (msg.method === "thread/start") {
    write({ id: msg.id, result: { thread: { id: "fake-preflight-thread" }, model: msg.params.model ?? "actual-default-model" } });
    return;
  }
  if (msg.method === "model/list" && process.env.FAKE_CODEX_INVENTORY_FAIL) {
    write({ id: msg.id, error: { code: -32000, message: "inventory unavailable: secret-must-not-leak" } });
    return;
  }
  if (msg.method === "model/list" && process.env.FAKE_CODEX_PAGES) {
    const data = answers["model/list"].data;
    const second = msg.params.cursor === "p2";
    write({ id: msg.id, result: { data: second ? data.slice(2) : data.slice(0, 2), nextCursor: second ? null : "p2" } });
  } else if (answers[msg.method] !== undefined) write({ id: msg.id, result: answers[msg.method] });
  else write({ id: msg.id, error: { code: -32601, message: `no such method ${msg.method}` } });
});
