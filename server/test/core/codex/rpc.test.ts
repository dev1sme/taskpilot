import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CodexError, RpcError } from "../../../src/core/codex/errors.js";
import { CodexRpc, codexLoggedIn, initializeCodex } from "../../../src/core/codex/rpc.js";

interface Line {
  dir: "send" | "recv" | "note";
  msg: Record<string, unknown> & { id?: number; method?: string; result?: unknown };
}
const fixture = (name: string): Line[] =>
  readFileSync(new URL(`../../fixtures/codex/${name}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);

/** A client wired to streams the test plays the server on. */
function pair() {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: Record<string, unknown>[] = [];
  input.on("data", (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => written.push(JSON.parse(l) as Record<string, unknown>)),
  );
  const rpc = new CodexRpc({ input, output });
  const serve = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);
  return { rpc, written, serve, output };
}
/** What a "request" event carries (the server asks something of us). */
interface ServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("CodexRpc", () => {
  it("matches responses to requests by id, whatever the order", async () => {
    const { rpc, written, serve } = pair();
    const a = rpc.request("a");
    const b = rpc.request("b", { x: 1 });
    expect(written).toEqual([
      { id: 1, method: "a" },
      { id: 2, method: "b", params: { x: 1 } },
    ]);
    serve({ id: 2, result: "B" });
    serve({ id: 1, result: "A" });
    await expect(Promise.all([a, b])).resolves.toEqual(["A", "B"]);
  });

  it("rejects with RpcError when the server answers an error", async () => {
    const { rpc, serve } = pair();
    const p = rpc.request("thread/resume");
    serve({ id: 1, error: { code: -32600, message: "no rollout found" } });
    await expect(p.catch((e: unknown) => e)).resolves.toMatchObject({ rpcCode: -32600, message: "no rollout found" });
    await expect(p).rejects.toBeInstanceOf(RpcError);
  });

  it("rejects on timeout and ignores the late answer", async () => {
    const { rpc, serve } = pair();
    const p = rpc.request("slow", undefined, 10);
    await expect(p).rejects.toMatchObject({ code: "timeout" });
    serve({ id: 1, result: "late" });
    await tick();
  });

  it("rejects pending requests and refuses new ones once closed", async () => {
    const { rpc, output } = pair();
    const closes: (number | null)[] = [];
    rpc.on("close", (code) => closes.push(code));
    const p = rpc.request("a");
    output.end();
    await expect(p).rejects.toMatchObject({ code: "closed" });
    expect(closes).toEqual([null]);
    expect(rpc.isClosed).toBe(true);
    await expect(rpc.request("b")).rejects.toBeInstanceOf(CodexError);
    rpc.notify("ignored");
    rpc.shutdown(0);
    expect(closes).toEqual([null]);
  });

  it("joins lines split over chunks and skips lines that are not JSON-RPC", async () => {
    const { rpc, output } = pair();
    const seen: string[] = [];
    const invalid: string[] = [];
    rpc.on("notification", (m) => seen.push(m));
    rpc.on("invalid", (l) => invalid.push(l));
    output.write('{"method":"a/b","para');
    output.write('ms":{}}\nnot json\n[1]\n{"id":{}}\n\n{"method":"c"}\n');
    await tick();
    expect(seen).toEqual(["a/b", "c"]);
    expect(invalid).toEqual(["not json", "[1]", '{"id":{}}']);
  });

  it("tells a server request from the response to our request with the same id", async () => {
    const { rpc, written, serve } = pair();
    const requests: ServerRequest[] = [];
    rpc.on("request", (r) => requests.push(r));
    const p = rpc.request("turn/start");
    serve({ id: 1, method: "item/commandExecution/requestApproval", params: { itemId: "i" } });
    serve({ id: 1, result: { turn: {} } });
    await expect(p).resolves.toEqual({ turn: {} });
    expect(requests).toEqual([{ id: 1, method: "item/commandExecution/requestApproval", params: { itemId: "i" } }]);
    expect(written).toEqual([{ id: 1, method: "turn/start" }]);
  });
});

describe("CodexRpc against recorded fixtures", () => {
  /** Plays the server of a fixture: answers each request of ours with the recorded response of the same id. */
  function replay(name: string) {
    const lines = fixture(name);
    const p = pair();
    const responses = new Map(lines.filter((l) => l.dir === "recv" && l.msg.id !== undefined && l.msg.method === undefined).map((l) => [l.msg.id, l.msg]));
    const seen = { notifications: [] as string[], requests: [] as ServerRequest[] };
    p.rpc.on("notification", (m) => seen.notifications.push(m));
    p.rpc.on("request", (r) => seen.requests.push(r));
    const origWrite = p.rpc.request.bind(p.rpc);
    let count = 0;
    p.rpc.request = ((method: string, params?: unknown, timeout?: number) => {
      const promise = origWrite(method, params, timeout);
      const id = ++count; // our ids count from 1, like the probe's
      queueMicrotask(() => p.serve(responses.get(id)));
      return promise;
    }) as typeof p.rpc.request;
    return { ...p, lines, seen };
  }

  it("completes the handshake, account/read and model/list of handshake.jsonl", async () => {
    const { rpc, written, seen } = replay("handshake");
    const init = await initializeCodex(rpc);
    expect(init.userAgent).toContain("/0.163.0");
    expect(written.at(-1)).toEqual({ method: "initialized" });
    await expect(codexLoggedIn(rpc)).resolves.toBe(true);
    const models = await rpc.request<{ data: { model: string }[] }>("model/list", { includeHidden: false });
    expect(models.data.map((m) => m.model)).toContain("gpt-6.1-sol");
    expect(seen.notifications).toEqual([]);
  });

  it("reports the account of not-logged-in.jsonl as logged out", async () => {
    const { rpc } = replay("not-logged-in");
    await initializeCodex(rpc);
    await expect(codexLoggedIn(rpc)).resolves.toBe(false);
  });

  it("refuses an initialize answer without userAgent, and an account/read without the account field", async () => {
    const a = pair();
    const init = initializeCodex(a.rpc);
    a.serve({ id: 1, result: {} });
    await expect(init).rejects.toMatchObject({ code: "protocol" });
    const b = pair();
    const login = codexLoggedIn(b.rpc);
    b.serve({ id: 1, result: { requiresOpenaiAuth: true } });
    await expect(login).rejects.toMatchObject({ code: "protocol" });
  });

  it("reads every line the server sent in each fixture without an invalid line", async () => {
    for (const name of ["turn", "not-logged-in"]) {
      const { rpc, serve, lines, seen } = replay(name);
      const invalid: string[] = [];
      rpc.on("invalid", (l) => invalid.push(l));
      for (const l of lines) if (l.dir === "recv") serve(l.msg);
      await tick();
      const methods = lines.filter((l) => l.dir === "recv" && l.msg.method !== undefined);
      expect(invalid, name).toEqual([]);
      expect(seen.notifications.length + seen.requests.length, name).toBe(methods.length);
    }
  });

  it("surfaces a JSON-RPC error as RpcError with its code", async () => {
    const { rpc, serve } = pair();
    const p = rpc.request("thread/resume", { threadId: "00000000-0000-7000-8000-000000000000" });
    serve({ id: 1, error: { code: -32600, message: "no rollout found for thread id" } });
    await expect(p).rejects.toMatchObject({ rpcCode: -32600, message: expect.stringContaining("no rollout found") });
  });
});
