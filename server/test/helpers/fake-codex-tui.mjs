// Deterministic stand-in for the `codex` TUI (not `codex app-server`), run in a PTY by tests and E2E.
// fake-codex.mjs starts it when argv has no `app-server`. It reads what the real launcher passes:
//   [resume <id>] --no-daemon -c … [-m <model>] [-c hooks.<Event>=[{hooks=[{type="command",command="…"}]}]]…
// and behaves like the TUI as far as TaskPilot sees it: prints the input-box footer, takes a bracketed paste + Enter,
// runs the hook commands from -c (stdin = JSON, env inherited, so the TASKPILOT_HOOK_AGENT guard applies), writes a rollout.
//
// Prompt triggers: WRITE:<file> writes a report (PLAN_TABLE: a plan with Codex members); APPROVAL asks for approval
// (y / Enter accepts, Esc declines); SLOW (or a "Việc N:" prompt with FAKE_CODEX_HOLD_MEMBER) holds a tool until Esc,
// which fires Interrupt (no Stop), as the real TUI does; RECALL answers with the previous prompt of the thread.
// Env: FAKE_CODEX_LOG (JSONL of what the stand-in started/received), FAKE_CODEX_WORKFLOW, FAKE_CODEX_TWO_MEMBERS,
// FAKE_CODEX_TABLE_MODEL, FAKE_CODEX_EXIT_LOG / _EXIT_DELAY_MS / _CLOSE_STDOUT_ON_STOP, FAKE_CODEX_CHILD_*.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (record) => {
  if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(record)}\n`);
};

// hooks.<Event>=[{hooks=[{type="command",command="<TOML string>"}]}]; a TOML basic string reads as JSON for what the launcher writes.
const hooks = new Map();
argv.forEach((arg, i) => {
  const hook = argv[i - 1] === "-c" ? /^hooks\.(\w+)=.*?command=("(?:[^"\\]|\\.)*")/s.exec(arg) : null;
  if (hook) hooks.set(hook[1], JSON.parse(hook[2]));
});

const resumeId = argv[0] === "resume" ? argv[1] : undefined;
const threadFile = (id) => path.join(process.cwd(), ".fake-codex-threads", `${id}.json`);
const rolloutFile = (id) => path.join(process.cwd(), ".fake-codex-threads", `rollout-${id}.jsonl`);
const threadId = resumeId ?? randomUUID();
const argModel = flag("-m");
let model = argModel ?? "gpt-6.1-sol";
let lastText = "";
let usage = { input: 0, output: 0 };
const save = () => {
  mkdirSync(path.dirname(threadFile(threadId)), { recursive: true });
  writeFileSync(threadFile(threadId), JSON.stringify({ lastText, model, usage }));
};
if (resumeId) {
  try {
    ({ lastText, model, usage } = { model, usage, ...JSON.parse(readFileSync(threadFile(resumeId), "utf8")) });
    if (argModel) model = argModel;
  } catch {
    process.stdout.write(`No saved session found with ID ${resumeId}\n`);
    process.exit(1);
  }
  log({ method: "thread/resume", params: { threadId, model: argModel, args: argv } });
} else {
  save();
  log({ method: "thread/start", params: { threadId, model: argModel, args: argv } });
}

let stopping = false;
process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  if (process.env.FAKE_CODEX_EXIT_LOG) appendFileSync(process.env.FAKE_CODEX_EXIT_LOG, "stop\n");
  if (process.env.FAKE_CODEX_CLOSE_STDOUT_ON_STOP) process.stdout.end();
  setTimeout(
    () => {
      if (process.env.FAKE_CODEX_EXIT_LOG) appendFileSync(process.env.FAKE_CODEX_EXIT_LOG, "exit\n");
      process.exit(0);
    },
    Number(process.env.FAKE_CODEX_EXIT_DELAY_MS ?? 0),
  );
});
// "start" says the SIGTERM handler is installed; the footer is the TUI's ready marker.
if (process.env.FAKE_CODEX_EXIT_LOG) appendFileSync(process.env.FAKE_CODEX_EXIT_LOG, "start\n");
if (process.env.FAKE_CODEX_CHILD_DELAY_MS) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const fs = require("node:fs");
    let stopping = false;
    // In a PTY the child gets SIGHUP when the session leader exits; a surviving tool has to outlast it.
    process.on("SIGHUP", () => {});
    process.on("SIGTERM", () => { if (!stopping) { stopping = true; setTimeout(() => process.exit(0), Number(process.env.FAKE_CODEX_CHILD_DELAY_MS)); } });
    fs.writeFileSync(process.env.FAKE_CODEX_CHILD_FILE, String(process.pid));
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: "ignore", detached: !!process.env.FAKE_CODEX_CHILD_DETACHED },
  );
  child.unref();
}

const payload = (event, extra = {}) => ({
  session_id: threadId,
  transcript_path: rolloutFile(threadId),
  cwd: process.cwd(),
  hook_event_name: event,
  model,
  permission_mode: "default",
  ...extra,
});
/** Runs the hook command Codex got for `event`; waits for it, so events reach TaskPilot in order. */
const fire = (event, extra) =>
  new Promise((done) => {
    const command = hooks.get(event);
    if (!command) return done();
    const child = spawn("/bin/sh", ["-c", command], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => done());
    child.on("close", () => done());
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload(event, extra)));
  });

const writeReport = (text) => {
  const member = /Việc (\d+):/.exec(text)?.[1];
  const builtIn = !process.env.FAKE_CODEX_WORKFLOW ? undefined : member ? `03-viec-${member}.md` : /bước [23]\/[23]/.test(text) ? "04-summary.md" : "02-plan.md";
  const output = /WRITE:([\w./-]+)/.exec(text)?.[1] ?? (builtIn && `.claude/tasks/DEMO-1/${builtIn}`);
  if (!output) return;
  const file = path.resolve(output);
  if (!file.startsWith(`${process.cwd()}/`)) throw new Error("Outside fake workspace");
  mkdirSync(path.dirname(file), { recursive: true });
  const table = [
    "# Plan\n\n## 7. Phân công\n\n| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |\n|---|---|---|---|---|---|---|---|",
    `| 1 | Report | codex | - | ${process.env.FAKE_CODEX_TABLE_MODEL ?? "-"} | server/ | Report | - |`,
    ...(process.env.FAKE_CODEX_TWO_MEMBERS ? [`| 2 | Next | codex | - | ${process.env.FAKE_CODEX_TABLE_MODEL ?? "-"} | server/ | Report | 1 |`] : []),
    "",
  ].join("\n");
  writeFileSync(file, text.includes("PLAN_TABLE") || builtIn === "02-plan.md" ? table : "# Report\n");
};

let turns = 0;
let state = "idle"; // idle | approval | held
let current; // { text, tool_use_id }
const toolInput = { command: "ls -a" };

async function endTurn(answer) {
  usage = { input: usage.input + 100, output: usage.output + 20 };
  mkdirSync(path.dirname(rolloutFile(threadId)), { recursive: true });
  appendFileSync(
    rolloutFile(threadId),
    `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: usage.input, output_tokens: usage.output } } } })}\n`,
  );
  save();
  state = "idle";
  const turn = current;
  current = undefined;
  process.stdout.write(`• ${answer.split("\n")[0]}\r\n`);
  await fire("Stop", { turn_id: turn?.turn_id, last_assistant_message: answer });
}

async function runTool(extra = {}) {
  await fire("PreToolUse", { turn_id: current.turn_id, tool_name: "Bash", tool_input: toolInput, tool_use_id: current.tool_use_id, ...extra });
}
async function toolDone(response = "README.md") {
  await fire("PostToolUse", { turn_id: current.turn_id, tool_name: "Bash", tool_input: toolInput, tool_use_id: current.tool_use_id, tool_response: response });
}

async function submit(raw) {
  // A terminal pastes line breaks as CR; Codex reads them as newlines.
  const text = raw.replace(/\r\n?/g, "\n");
  log({ method: "turn/start", params: { threadId, input: [{ type: "text", text }] } });
  const remembered = lastText;
  lastText = text;
  turns += 1;
  process.stdout.write(`› ${text.split("\n")[0]}\r\n`);
  current = { text, turn_id: randomUUID(), tool_use_id: `exec-${randomUUID()}` };
  // Codex sends SessionStart together with the first prompt, not when it opens.
  if (turns === 1) await fire("SessionStart", { source: resumeId ? "resume" : "startup" });
  await fire("UserPromptSubmit", { turn_id: current.turn_id, prompt: text });
  if (text.includes("APPROVAL")) {
    await runTool();
    state = "approval";
    await fire("PermissionRequest", { turn_id: current.turn_id, tool_name: "Bash", tool_input: toolInput, tool_use_id: current.tool_use_id });
    process.stdout.write("Would you like to run the following command?\r\n1. Yes, proceed (y)\r\n");
  } else if (text.includes("SLOW") || (process.env.FAKE_CODEX_HOLD_MEMBER && /Việc \d+:/.test(text))) {
    state = "held";
    await runTool({ tool_input: { command: "sleep 60" } });
    process.stdout.write("Working (1s • esc to interrupt)\r\n");
  } else {
    writeReport(text);
    await runTool();
    await toolDone();
    await endTurn(text.includes("RECALL") ? remembered : "DONE");
  }
}

async function answerApproval(accepted) {
  if (accepted) writeReport(current.text);
  await toolDone(accepted ? "ok" : "rejected by user");
  await endTurn(accepted ? "APPROVED" : "DECLINED");
}

async function interrupt() {
  state = "idle";
  const turn = current;
  current = undefined;
  process.stdout.write("■ Conversation interrupted\r\n");
  await fire("Interrupt", { turn_id: turn?.turn_id });
}

let buffer = "";
let pasted; // text of an open paste, or of a finished one still waiting for Enter
let pasteOpen = false;
let queue = Promise.resolve();
const enqueue = (work) => {
  queue = queue.then(work).catch(() => {});
};
function onInput(data) {
  if (state === "approval" || state === "held") {
    // Keys of the approval dialog and Esc during a running tool; a lone ESC byte, not an escape sequence.
    if (data === "\x1b") enqueue(() => (state === "approval" ? answerApproval(false) : interrupt()));
    else if (state === "approval" && (data === "y" || data === "\r")) enqueue(() => answerApproval(true));
    return;
  }
  buffer += data;
  for (;;) {
    if (pasted === undefined) {
      const start = buffer.indexOf("\x1b[200~");
      if (start < 0) {
        // Typed, not pasted: a line up to Enter is a prompt too.
        const enter = buffer.indexOf("\r");
        if (enter < 0) return;
        const typed = buffer.slice(0, enter);
        buffer = buffer.slice(enter + 1);
        if (typed.trim()) enqueue(() => submit(typed));
        continue;
      }
      buffer = buffer.slice(start + 6);
      pasted = "";
      pasteOpen = true;
    }
    if (pasteOpen) {
      const end = buffer.indexOf("\x1b[201~");
      if (end < 0) return void ((pasted += buffer), (buffer = ""));
      pasted += buffer.slice(0, end);
      buffer = buffer.slice(end + 6);
      pasteOpen = false;
    }
    const enter = buffer.indexOf("\r");
    if (enter < 0) return; // the prompt waits for Enter
    buffer = buffer.slice(enter + 1);
    const text = pasted;
    pasted = undefined;
    enqueue(() => submit(text));
  }
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", onInput);
process.stdin.on("end", () => {
  if (!stopping) process.exit(0);
});
process.stdout.write("\x1b[?2004h"); // the TUI asks the terminal for bracketed paste
process.stdout.write(`gpt-6.1-sol default · ~/repo\n`);
