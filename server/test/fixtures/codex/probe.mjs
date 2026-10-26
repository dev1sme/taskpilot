#!/usr/bin/env node
// Drives a real `codex app-server --listen stdio://` through one scenario and records every JSON-RPC line
// (both directions) to <out>/<scenario>.jsonl. The recordings are the fixtures that fakes and mapping tests replay.
// Spends ChatGPT quota: every scenario except `handshake` and `not-logged-in` runs at least one short turn.
//
//   node server/test/fixtures/codex/probe.mjs --scenario turn --repo /tmp/probe-repo --out server/test/fixtures/codex
//   CODEX_HOME=$(mktemp -d) node server/test/fixtures/codex/probe.mjs --scenario not-logged-in
//
// Each fixture line is `{"dir":"send"|"recv"|"note","msg":…}`. Paths, e-mail and ids that identify the account are
// redacted (see `redact`). `TASKPILOT_CODEX` overrides the codex binary, like the server does.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCENARIOS = [
  "handshake",
  "turn",
  "git-commit",
  "network",
  "npm-test",
  "not-logged-in",
];

function parseArgs(argv) {
  const args = { scenario: "", repo: "", out: path.dirname(new URL(import.meta.url).pathname), timeout: 180_000 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    if (key in args) args[key] = key === "timeout" ? Number(argv[++i]) : argv[++i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!SCENARIOS.includes(args.scenario)) throw new Error(`--scenario must be one of: ${SCENARIOS.join(", ")}`);
  return args;
}

// A throwaway git repo so `workspace-write` has a workspace that is not this checkout.
function scratchRepo(dir) {
  const repo = dir || mkdtempSync(path.join(os.tmpdir(), "codex-probe-repo-"));
  mkdirSync(repo, { recursive: true });
  if (!existsSync(path.join(repo, ".git"))) {
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(path.join(repo, "README.md"), "# probe repo\n");
  }
  return repo;
}

// Real-world commands for the permission probe: which of them make `workspace-write` + `on-request` ask for approval.
const COMMAND_SCENARIOS = {
  "git-commit": "Run exactly this one shell command and nothing else: git add -A && git commit -m probe\nThen reply with one word: DONE or FAILED.",
  network: "Run exactly this one shell command and nothing else: curl -sS -m 15 -o /dev/null -w '%{http_code}' https://example.com\nThen reply with one word: DONE or FAILED.",
  "npm-test": "Run exactly this one shell command and nothing else: npm test\nThen reply with one word: DONE or FAILED.",
};

const HOME = os.homedir();
function redactor(repo, outside) {
  const pairs = [
    [repo, "<REPO>"],
    [outside, "<OUTSIDE>"],
    [process.env.CODEX_HOME || path.join(HOME, ".codex"), "<CODEX_HOME>"],
    [os.tmpdir(), "<TMP>"],
    [HOME, "<HOME>"],
  ].filter(([from]) => from);
  return function redact(text) {
    for (const [from, to] of pairs) text = text.split(from).join(to);
    return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<EMAIL>").replace(/"(installationId|userId|accountId|chatgptAccountId)":(\s*)"[^"]*"/g, '"$1":$2"<ID>"');
  };
}

class AppServer {
  constructor({ env, log }) {
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.onRequest = () => undefined;
    const bin = process.env.TASKPILOT_CODEX ?? "codex";
    this.child = spawn(bin, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.log("note", { spawned: [bin, "app-server", "--listen", "stdio://"], pid: this.child.pid });
    this.exited = new Promise((resolve) => this.child.on("exit", (code, signal) => resolve({ code, signal })));
    this.child.on("error", (err) => this.log("note", { spawnError: err.code ?? String(err) }));
    this.child.stderr.on("data", (d) => process.stderr.write(`[codex stderr] ${d}`));
    let buf = "";
    this.child.stdout.on("data", (chunk) => {
      buf += chunk;
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.receive(line);
      }
    });
  }

  receive(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log("note", { nonJson: line });
      return;
    }
    this.log("recv", msg);
    if (msg.id !== undefined && msg.method) {
      void Promise.resolve(this.onRequest(msg)).then((result) => {
        if (result !== undefined) this.send({ id: msg.id, result });
      });
    } else if (msg.id !== undefined) {
      const waiter = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      waiter?.(msg);
    } else {
      for (const fn of [...this.listeners]) fn(msg);
    }
  }

  send(msg) {
    this.log("send", msg);
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  // Resolves with the whole response (`result` or `error`) so scenarios can record failures instead of throwing.
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  notify(method, params) {
    this.send(params === undefined ? { method } : { method, params });
  }

  // Waits for the first notification matching `pred`, or null after `ms`.
  waitFor(pred, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        resolve(null);
      }, ms);
      const fn = (msg) => {
        if (!pred(msg)) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== fn);
        resolve(msg);
      };
      this.listeners.push(fn);
    });
  }

  async initialize(experimentalApi = false) {
    const res = await this.request("initialize", {
      clientInfo: { name: "taskpilot_probe", title: "TaskPilot probe", version: "0.1.0" },
      capabilities: { experimentalApi, requestAttestation: false },
    });
    this.notify("initialized");
    return res;
  }

  async close() {
    this.child.stdin.end();
    const done = await Promise.race([this.exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
    if (!done) this.child.kill("SIGTERM");
    return done ?? (await this.exited);
  }
}

const text = (t) => [{ type: "text", text: t, text_elements: [] }];
const isTurnDone = (threadId) => (m) => m.method === "turn/completed" && m.params?.threadId === threadId;

// Starts a thread and one turn, then waits for `turn/completed`. Approval requests get `decision` (or none).
async function oneTurn(server, { threadParams, prompt, decision, timeout, turnExtra = {} }) {
  if (decision) server.onRequest = () => ({ decision });
  const started = await server.request("thread/start", threadParams);
  if (started.error) return { started };
  const threadId = started.result.thread.id;
  const done = server.waitFor(isTurnDone(threadId), timeout);
  const turn = await server.request("turn/start", { threadId, input: text(prompt), ...turnExtra });
  if (turn.error) return { started, turn };
  return { started, turn, completed: await done };
}

async function run(args) {
  // workspace-write also allows /tmp and $TMPDIR, so "outside the workspace" has to live elsewhere: under ~/.cache.
  mkdirSync(path.join(HOME, ".cache"), { recursive: true });
  const outsideBase = mkdtempSync(path.join(HOME, ".cache", "taskpilot-codex-probe-"));
  const repo = args.scenario === "handshake" || args.scenario === "not-logged-in" ? "" : scratchRepo(args.repo);
  const redact = redactor(repo, outsideBase);
  const lines = [];
  const log = (dir, msg) => lines.push(redact(JSON.stringify({ dir, msg })));
  const env = { ...process.env };
  const server = new AppServer({ env, log });
  const timeout = args.timeout;
  // acceptEdits row of the permission table.
  const acceptEdits = { cwd: repo, sandbox: "workspace-write", approvalPolicy: "on-request" };
  const summary = {};

  try {
    const init = await server.initialize();
    summary.initialize = init.result ?? init.error;
    if (init.error) return;

    switch (args.scenario) {
      case "handshake": {
        summary.account = (await server.request("account/read", { refreshToken: false })).result;
        const models = await server.request("model/list", { includeHidden: false });
        summary.models = models.result?.data?.map((m) => m.id ?? m.model);
        break;
      }
      case "not-logged-in": {
        const account = await server.request("account/read", { refreshToken: false });
        summary.account = account.result ?? account.error;
        const models = await server.request("model/list", {});
        summary.models = models.error ?? models.result?.data?.length;
        const dir = mkdtempSync(path.join(os.tmpdir(), "codex-probe-nologin-"));
        const r = await oneTurn(server, { threadParams: { cwd: dir, sandbox: "read-only", approvalPolicy: "never" }, prompt: "Reply OK.", timeout: 60_000 });
        summary.threadStart = r.started.error ?? "ok";
        summary.turn = r.turn?.error ?? r.completed?.params?.turn?.status ?? "no turn/completed";
        summary.turnError = r.completed?.params?.turn?.error;
        break;
      }
      case "turn": {
        const prompt =
          "This is line one of a multi-line prompt.\nLine two: run `ls` in the workspace.\nLine three: then create a file named probe.txt containing the word hello.\nReply with DONE when finished.";
        const r = await oneTurn(server, { threadParams: acceptEdits, prompt, timeout });
        summary.status = r.completed?.params?.turn?.status;
        summary.wroteFile = existsSync(path.join(repo, "probe.txt")) && readFileSync(path.join(repo, "probe.txt"), "utf8").trim();
        break;
      }
      case "git-commit":
      case "network":
      case "npm-test": {
        if (args.scenario === "git-commit") {
          execFileSync("git", ["-C", repo, "config", "user.name", "probe"]);
          execFileSync("git", ["-C", repo, "config", "user.email", "probe@example.invalid"]);
          writeFileSync(path.join(repo, "change.txt"), "change\n");
        }
        if (args.scenario === "npm-test") {
          writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "probe", version: "0.0.0", scripts: { test: "node -e \"console.log('tests ok')\"" } }) + "\n");
        }
        // Every approval is accepted so the command really runs; what was asked is the evidence.
        const approvals = [];
        server.onRequest = (msg) => {
          approvals.push({ method: msg.method, reason: msg.params?.reason, command: msg.params?.command, cwd: msg.params?.cwd });
          return { decision: "accept" };
        };
        const r = await oneTurn(server, { threadParams: acceptEdits, prompt: COMMAND_SCENARIOS[args.scenario], timeout });
        summary.status = r.completed?.params?.turn?.status;
        summary.approvals = approvals;
        // A failed turn (usage limit, auth) proves nothing about approvals; do not record it as a fixture.
        if (summary.status !== "completed") summary.error = r.completed?.params?.turn?.error ?? "no turn/completed";
        if (args.scenario === "git-commit") {
          try {
            summary.commits = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
              .trim()
              .split("\n").length;
          } catch {
            summary.commits = 0;
          }
        }
        break;
      }
    }
  } finally {
    const exit = server.child.exitCode === null && server.child.signalCode === null ? await server.close() : await server.exited;
    summary.exit = exit;
    log("note", { summary });
    if (args.out) {
      mkdirSync(args.out, { recursive: true });
      writeFileSync(path.join(args.out, `${args.scenario}.jsonl`), lines.join("\n") + "\n");
    }
    process.stdout.write(redact(JSON.stringify(summary, null, 2)) + "\n");
    rmSync(outsideBase, { recursive: true, force: true });
  }
}

run(parseArgs(process.argv.slice(2))).catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
