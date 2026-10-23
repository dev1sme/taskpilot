#!/usr/bin/env node
// Stands in for `copilot` in tests: on `--acp` replays fixtures/copilot/acp-handshake.jsonl by request id order
// (initialize, session/new). FAKE_COPILOT_COUNT_FILE gets a line per start; FAKE_COPILOT_MODELS (JSON) replaces
// availableModels; FAKE_COPILOT_FAIL=1 exits at once; FAKE_COPILOT_HANG=1 never answers session/new.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.env.FAKE_COPILOT_COUNT_FILE) appendFileSync(process.env.FAKE_COPILOT_COUNT_FILE, `${process.argv.slice(2).join(" ")}|${process.cwd()}\n`);
if (process.env.FAKE_COPILOT_FAIL) {
  console.error("copilot: boom");
  process.exit(3);
}

const recorded = readFileSync(new URL("../../fixtures/copilot/acp-handshake.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line).msg.result);
const answers = { initialize: recorded[0], "session/new": structuredClone(recorded[1]), "session/close": {} };
if (process.env.FAKE_COPILOT_MODELS) answers["session/new"].models.availableModels = JSON.parse(process.env.FAKE_COPILOT_MODELS);

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "session/new" && process.env.FAKE_COPILOT_HANG) return;
  write({ id: msg.id, result: answers[msg.method] ?? {} });
});
