#!/bin/sh
# PTY stand-in: version probe, readiness, bracketed paste and authenticated hooks; no real CLI.
if [ "$1" = "--version" ]; then
  echo "fake-agent 1.0.101"
  exit 0
fi
# The account poller uses framed RPC instead of a PTY. Report unavailable credentials
# deterministically, without inventing quota evidence or waiting for its real timeout.
if [ "$1" = "--headless" ]; then
  exec node --input-type=commonjs -e '
  let input = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    input = Buffer.concat([input, chunk]);
    const end = input.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(input.subarray(0, end).toString())?.[1]);
    if (!Number.isFinite(length) || input.length < end + 4 + length) return;
    const request = JSON.parse(input.subarray(end + 4, end + 4 + length).toString());
    const response = JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "not authenticated (fake)" } });
    process.stdout.write("Content-Length: " + Buffer.byteLength(response) + "\r\n\r\n" + response);
  });
  '
fi
exec node --input-type=commonjs -e '
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(1);
if (args.includes("--version")) { console.log("copilot 1.0.101 (fake)"); process.exit(0); }
const agent = process.env.TASKPILOT_FAKE_AGENT ?? "copilot";
const scenario = process.env[agent === "claude" ? "FAKE_CLAUDE_SCENARIO" : "FAKE_COPILOT_SCENARIO"];
const sessionId = args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1];
const log = (entry) => fs.appendFileSync(".fake-" + agent + ".jsonl", JSON.stringify({ sessionId, ...entry }) + "\n");
log({ args });
const hook = async (event, extra = {}) => {
  if (!process.env.TASKPILOT_HOOK_URL) return;
  const response = await fetch(process.env.TASKPILOT_HOOK_URL + "/" + event, {
    method: "POST",
    headers: { "content-type": "application/json", "x-taskpilot-hook-token": process.env.TASKPILOT_HOOK_TOKEN },
    body: JSON.stringify({ session_id: sessionId, ...extra }),
  });
  if (!response.ok) throw new Error("Fake hook failed: " + response.status);
};
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
let input = "";
let queue = agent === "claude" ? hook("SessionStart") : Promise.resolve();
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const end = input.indexOf("\x1b[201~");
    if (end < 0) break;
    const text = input.slice(0, end).replace(/^[\s\S]*?\x1b\[200~/, "");
    input = input.slice(end + 6);
    queue = queue.then(async () => {
      log({ text });
      if (scenario === "no-hook") return;
      await hook("UserPromptSubmit");
      console.log("got:" + text);
      if (scenario === "busy") return;
      if (scenario === "approval") {
        await hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "echo fixture" } });
        return;
      }
      const output = scenario === "complete" && /WRITE:([\w./-]+)/.exec(text)?.[1];
      if (output) {
        const file = path.resolve(output);
        if (!file.startsWith(process.cwd() + path.sep)) throw new Error("Outside fake workspace");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "# Fake " + agent + " report\n");
      }
      await hook("Stop", { last_assistant_message: "Fake " + agent + " received prompt" });
    }).catch((error) => { console.error(error.message); process.exit(1); });
  }
});
console.log("fake copilot / commands");
' -- "$@"
