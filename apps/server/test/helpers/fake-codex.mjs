// Synthetic test runtime only: never starts Codex, contacts an account, or fabricates smoke evidence.
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli 0.165.0 (fake)");
  process.exit(0);
}
if (args.includes("app-server")) {
  createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    const replies = {
      initialize: { userAgent: "codex-cli/0.165.0 (fake)" },
      "account/read": { account: { type: "chatgpt" } },
      "model/list": { data: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true }], nextCursor: null },
      "account/rateLimits/read": { rateLimits: {} },
    };
    console.log(JSON.stringify({ id: request.id, ...(request.method in replies ? { result: replies[request.method] } : { error: { code: -32601, message: "Unsupported fake method" } }) }));
  });
} else {
  const nativeId = args[0] === "resume" ? args[1] : randomUUID();
  const rollout = path.join(process.cwd(), `.fake-codex-${nativeId}.jsonl`);
  if (!existsSync(rollout)) writeFileSync(rollout, JSON.stringify({ type: "session_meta", payload: { id: nativeId, source: "cli", cwd: process.cwd() } }) + "\n");
  const scenario = () => process.env.FAKE_CODEX_SCENARIO ?? (existsSync(".fake-codex-scenario") ? readFileSync(".fake-codex-scenario", "utf8").trim() : "tokens");
  const hook = async (event, turnId, extra = {}) => {
    if (!process.env.TASKPILOT_HOOK_URL) return;
    const response = await fetch(`${process.env.TASKPILOT_HOOK_URL}/${event}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-taskpilot-hook-token": process.env.TASKPILOT_HOOK_TOKEN },
      body: JSON.stringify({ session_id: nativeId, hook_event_name: event, transcript_path: rollout, cwd: process.cwd(), turn_id: turnId, model: "gpt-6.1-sol", ...extra }),
    });
    if (!response.ok) throw new Error(`Fake hook failed: ${response.status}`);
  };
  let input = "";
  let first = true;
  let queue = Promise.resolve();
  let turnId;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    if (chunk.includes("\x03")) {
      queue = queue.then(() => hook("Stop", turnId, { hook_event_name: "Interrupt" }));
      return;
    }
    input += chunk;
    for (;;) {
      const end = input.indexOf("\x1b[201~");
      if (end < 0) break;
      input = input.slice(end + 6);
      queue = queue
        .then(async () => {
          if (scenario() === "no-hook") return;
          turnId = randomUUID();
          if (first) {
            first = false;
            await hook("SessionStart", turnId, { source: args[0] === "resume" ? "resume" : "startup" });
          }
          await hook("UserPromptSubmit", turnId);
          if (scenario() === "busy") return;
          if (scenario() === "missing") {
            if (existsSync(rollout)) unlinkSync(rollout);
          } else {
            appendFileSync(
              rollout,
              JSON.stringify({
                type: "event_msg",
                timestamp: "2026-10-29T04:00:00Z",
                payload: { type: "token_count", info: { total_token_usage: { input_tokens: scenario() === "zero" ? 0 : 120, output_tokens: scenario() === "zero" ? 0 : 30 } } },
              }) + "\n",
            );
          }
          await hook("Stop", turnId, { last_assistant_message: "Synthetic Codex turn" });
          if (scenario() === "duplicate") await hook("Stop", turnId, { last_assistant_message: "Synthetic Codex turn" });
        })
        .catch((error) => {
          console.error(error.message);
          process.exit(1);
        });
    }
  });
  console.log(`gpt-6.1-sol medium · ${process.cwd()}`);
}
