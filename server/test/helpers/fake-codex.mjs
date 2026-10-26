#!/usr/bin/env node
// `codex` stand-in. With `app-server` in argv it is the app-server TaskPilot still uses for the probe and the
// account limits (shapes from the 0.163.0 recordings); otherwise it is the Codex TUI (fake-codex-tui.mjs),
// which is how the launcher starts a session: `codex [resume <id>] --no-daemon -c …`.
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.163.0");
  process.exit(0);
}
if (!process.argv.includes("app-server")) {
  await import("./fake-codex-tui.mjs");
} else {
  startAppServer();
}

function startAppServer() {
  const recorded = readFileSync(new URL("../fixtures/codex/turn.jsonl", import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
    .filter((r) => r.dir === "recv")
    .map((r) => r.msg);
  // Real snapshot from the recording; the read response wraps it like GetAccountRateLimitsResponse.
  const rateLimits = recorded.find((m) => m.method === "account/rateLimits/updated").params.rateLimits;
  const send = (m) => {
    if (!process.stdout.writableEnded) process.stdout.write(`${JSON.stringify(m)}\n`);
  };
  const reply = (id, result) => send({ id, result });
  const error = (id, message) => send({ id, error: { code: -32600, message } });
  process.on("SIGTERM", () => process.exit(0));

  createInterface({ input: process.stdin }).on("line", (line) => {
    const m = JSON.parse(line);
    if (!m.method) return;
    if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ method: m.method, params: m.params ?? {} })}\n`);
    if (m.method === "initialize") {
      if (process.env.FAKE_CODEX_INIT_DELAY_MS) setTimeout(() => reply(m.id, { userAgent: "codex-cli/0.163.0" }), Number(process.env.FAKE_CODEX_INIT_DELAY_MS));
      else reply(m.id, { userAgent: "codex-cli/0.163.0" });
    } else if (m.method === "initialized") return;
    else if (m.method === "account/read") reply(m.id, { account: process.env.FAKE_CODEX_LOGGED_OUT ? null : { type: "chatgpt" } });
    else if (m.method === "account/rateLimits/read") {
      if (process.env.FAKE_CODEX_NO_RATE_LIMITS) error(m.id, "rate limits unavailable");
      else reply(m.id, { rateLimits, rateLimitsByLimitId: { codex: rateLimits } });
    } else if (m.method === "model/list") reply(m.id, { data: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true }], nextCursor: null });
    else error(m.id, `Unsupported method ${m.method}`);
  });
}
