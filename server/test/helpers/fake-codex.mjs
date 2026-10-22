#!/usr/bin/env node
// Deterministic app-server stand-in. Item/turn/approval shapes come from the 0.163.0 recordings.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.163.0");
  process.exit(0);
}
const records = (scenario) =>
  readFileSync(new URL(`../fixtures/codex/${scenario}.jsonl`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s))
    .filter((r) => r.dir === "recv")
    .map((r) => r.msg);
const sample = records("turn");
const approvalSample = records("approval-accept");
const editSample = records("edit");
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const notify = (method, params) => send({ method, params: { threadId, ...params } });
const reply = (id, result) => send({ id, result });
const error = (id, message) => send({ id, error: { code: -32600, message } });
let threadId,
  turnId,
  lastText = "",
  pending,
  tool;
let model = "gpt-6.1-sol";
const writeReport = (text) => {
  const output = /WRITE:([\w./-]+)/.exec(text)?.[1];
  if (!output) return;
  const file = path.resolve(output);
  if (!file.startsWith(`${process.cwd()}/`)) throw new Error("Outside fake workspace");
  mkdirSync(path.dirname(file), { recursive: true });
  const table =
    "# Plan\n\n## 7. Phân công\n\n| # | Việc | Agent | Subagent | Model | File | Đầu ra | Phụ thuộc |\n|---|---|---|---|---|---|---|---|\n| 1 | Report | codex | - | - | server/ | Report | - |\n";
  writeFileSync(file, text.includes("PLAN_TABLE") ? table : "# Report\n");
};
const threadFile = (id) => path.join(process.cwd(), ".fake-codex-threads", `${id}.json`);
const save = () => {
  mkdirSync(path.dirname(threadFile(threadId)), { recursive: true });
  writeFileSync(threadFile(threadId), JSON.stringify({ lastText, model }));
};
const finish = (text = "DONE", status = "completed") => {
  const agent = { type: "agentMessage", id: randomUUID(), text, phase: "final_answer" };
  if (status === "completed") {
    notify("item/started", { turnId, item: { ...agent, text: "" } });
    notify("item/agentMessage/delta", { turnId, itemId: agent.id, delta: text });
    notify("item/completed", { turnId, item: agent });
  }
  notify("thread/tokenUsage/updated", { turnId, tokenUsage: { total: { inputTokens: 100, outputTokens: 20 } } });
  notify("turn/completed", { turn: { id: turnId, status, items: status === "completed" ? [agent] : [], error: null } });
  turnId = undefined;
  pending = undefined;
  tool = undefined;
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (!m.method) {
    if (pending && m.id === pending.id) {
      const decision = m.result?.decision;
      if (decision === "accept") writeReport(lastText);
      notify("serverRequest/resolved", { requestId: m.id });
      if (tool) notify("item/completed", { turnId, item: { ...tool, status: decision === "accept" ? "completed" : "declined" } });
      finish(decision === "accept" ? "APPROVED" : "DECLINED", decision === "cancel" ? "interrupted" : "completed");
    }
    return;
  }
  const p = m.params ?? {};
  if (m.method === "initialize") reply(m.id, { userAgent: "codex-cli/0.163.0" });
  else if (m.method === "initialized") return;
  else if (m.method === "account/read") reply(m.id, { account: process.env.FAKE_CODEX_LOGGED_OUT ? null : { type: "chatgpt" } });
  else if (m.method === "model/list") reply(m.id, { data: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", isDefault: true }], nextCursor: null });
  else if (m.method === "thread/start" || m.method === "thread/resume") {
    model = p.model ?? model;
    if (m.method === "thread/resume") {
      threadId = p.threadId;
      try {
        ({ lastText, model } = JSON.parse(readFileSync(threadFile(threadId), "utf8")));
      } catch {
        error(m.id, "Thread not found");
        return;
      }
    } else {
      threadId = randomUUID();
      save();
    }
    if (process.env.FAKE_CODEX_PROTOCOL) reply(m.id, {});
    else reply(m.id, { thread: { id: threadId }, model });
  } else if (m.method === "turn/start") {
    const text = p.input.map((i) => i.text).join("\n");
    if (text.includes("RPC_FAIL")) {
      error(m.id, "turn/start rejected");
      return;
    }
    const active = !!turnId;
    turnId ??= randomUUID();
    reply(m.id, { turn: { id: turnId, status: "inProgress" } });
    if (!active) notify("turn/started", { turn: { id: turnId, status: "inProgress", items: [] } });
    notify("item/completed", { turnId, item: { type: "userMessage", id: randomUUID(), content: [{ type: "text", text }] } });
    if (active) return;
    const remembered = lastText;
    lastText = text;
    save();
    if (text.includes("APPROVAL")) {
      tool = { ...approvalSample.find((m) => m.method === "item/started" && m.params.item.type === "commandExecution").params.item, id: randomUUID() };
      notify("item/started", { turnId, item: tool });
      pending = { ...approvalSample.find((m) => m.method === "item/commandExecution/requestApproval"), id: 0 };
      send({ ...pending, params: { ...pending.params, threadId, turnId, itemId: tool.id } });
    } else if (text.includes("TOOL_TYPES")) {
      const file = editSample.find((m) => m.method === "item/started" && m.params.item.type === "fileChange").params.item;
      for (const item of [
        file,
        { type: "mcpToolCall", server: "docs", tool: "search", arguments: { query: "test" } },
        { type: "webSearch", action: { query: "test" } },
        { type: "futureTool" },
      ]) {
        const id = randomUUID();
        notify("item/started", { turnId, item: { ...item, id, status: "inProgress" } });
        notify("item/completed", { turnId, item: { ...item, id, status: "completed" } });
      }
      finish();
    } else if (text.includes("SLOW")) {
      tool = { type: "commandExecution", id: randomUUID(), command: "sleep 60", status: "inProgress" };
      notify("item/started", { turnId, item: tool });
    } else if (text.includes("UNSUPPORTED")) {
      send({ id: 42, method: "item/tool/requestUserInput", params: { threadId, turnId } });
      setTimeout(() => finish(), 25);
    } else if (text.includes("RETRY")) {
      notify("error", { error: { message: "Reconnecting" }, willRetry: true });
      setTimeout(() => finish(), 25);
    } else if (text.includes("FAIL_TURN")) {
      notify("error", { error: { message: "model failed" }, willRetry: false });
      notify("turn/completed", { turn: { id: turnId, status: "failed", error: { message: "model failed" }, items: [] } });
      turnId = undefined;
    } else {
      writeReport(text);
      // Replay a recorded shell tool, retaining real protocol fields.
      const entry = sample.find((m) => m.method === "item/started" && m.params.item.type === "commandExecution").params.item;
      const id = randomUUID();
      notify("item/started", { turnId, item: { ...entry, id } });
      notify("item/completed", { turnId, item: { ...entry, id, status: "completed", aggregatedOutput: "README.md" } });
      finish(text.includes("RECALL") ? remembered : "DONE");
    }
  } else if (m.method === "turn/interrupt") {
    reply(m.id, {});
    finish("", "interrupted");
  } else error(m.id, `Unsupported method ${m.method}`);
});
