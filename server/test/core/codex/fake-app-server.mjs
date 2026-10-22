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

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "model/list" && process.env.FAKE_CODEX_PAGES) {
    const data = answers["model/list"].data;
    const second = msg.params.cursor === "p2";
    write({ id: msg.id, result: { data: second ? data.slice(2) : data.slice(0, 2), nextCursor: second ? null : "p2" } });
  } else if (answers[msg.method] !== undefined) write({ id: msg.id, result: answers[msg.method] });
  else write({ id: msg.id, error: { code: -32601, message: `no such method ${msg.method}` } });
});
