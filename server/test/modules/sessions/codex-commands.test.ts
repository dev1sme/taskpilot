import { describe, expect, it, vi } from "vitest";
import { parseCodexCommand, resolveCodexInput } from "../../../src/modules/sessions/transports/codex-commands.js";

function ctx(answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  return { request, ctx: { rpc: { request }, threadId: "T1", cwd: "/repo" } };
}

const skills = {
  data: [
    {
      cwd: "/repo",
      skills: [
        { name: "lint", path: "/s/lint/SKILL.md", enabled: true, description: "d" },
        { name: "off", path: "/s/off", enabled: false },
      ],
    },
  ],
};
const models = { data: [{ id: "gpt-5", model: "gpt-5", isDefault: true }] };

describe("parseCodexCommand", () => {
  it("maps supported commands and review targets", () => {
    expect(parseCodexCommand("/compact")).toEqual({ kind: "compact" });
    expect(parseCodexCommand("/review")).toEqual({ kind: "review", target: { type: "uncommittedChanges" } });
    expect(parseCodexCommand("/review branch main")).toEqual({ kind: "review", target: { type: "baseBranch", branch: "main" } });
    expect(parseCodexCommand("/review commit abc123")).toEqual({ kind: "review", target: { type: "commit", sha: "abc123" } });
    expect(parseCodexCommand("/review focus on auth")).toEqual({ kind: "review", target: { type: "custom", instructions: "focus on auth" } });
    expect(parseCodexCommand("/model gpt-5")).toEqual({ kind: "model", id: "gpt-5" });
    expect(parseCodexCommand("$lint fix it")).toEqual({ kind: "skill", name: "lint", rest: "fix it" });
  });

  it("flags other slash commands but leaves paths and plain text alone", () => {
    expect(parseCodexCommand("/foo bar")).toEqual({ kind: "unsupported", name: "foo" });
    expect(parseCodexCommand("/home/user/file.ts is broken")).toBeNull();
    expect(parseCodexCommand("fix /compact")).toBeNull();
  });
});

describe("resolveCodexInput", () => {
  it("compact and review call their RPC", async () => {
    const a = ctx();
    expect(await resolveCodexInput("/compact", a.ctx)).toMatchObject({ kind: "handled" });
    expect(a.request).toHaveBeenCalledWith("thread/compact/start", { threadId: "T1" });
    const b = ctx();
    await resolveCodexInput("/review", b.ctx);
    expect(b.request).toHaveBeenCalledWith("review/start", { threadId: "T1", target: { type: "uncommittedChanges" }, delivery: "inline" });
  });

  it("reports unsupported commands without calling the model", async () => {
    const a = ctx();
    const r = await resolveCodexInput("/init", a.ctx);
    expect(r).toMatchObject({ kind: "handled", error: expect.stringContaining("TUI Codex") });
    expect(a.request).not.toHaveBeenCalled();
  });

  it("/model checks model/list", async () => {
    const a = ctx({ "model/list": models });
    expect(await resolveCodexInput("/model gpt-5", a.ctx)).toMatchObject({ kind: "handled", model: "gpt-5" });
    expect(await resolveCodexInput("/model nope", a.ctx)).toMatchObject({ kind: "handled", error: expect.stringContaining("nope") });
  });

  it("$skill becomes a skill input plus text; unknown names stay plain text", async () => {
    const a = ctx({ "skills/list": skills });
    expect(await resolveCodexInput("$lint now", a.ctx)).toEqual({
      kind: "turn",
      input: [
        { type: "skill", name: "lint", path: "/s/lint/SKILL.md" },
        { type: "text", text: "now", text_elements: [] },
      ],
    });
    expect(await resolveCodexInput("$HOME is set", a.ctx)).toEqual({ kind: "turn", input: [{ type: "text", text: "$HOME is set", text_elements: [] }] });
    expect(await resolveCodexInput("$off", a.ctx)).toMatchObject({ kind: "turn", input: [{ type: "text" }] });
  });

  it("/skills lists enabled skills", async () => {
    const a = ctx({ "skills/list": skills });
    const r = await resolveCodexInput("/skills", a.ctx);
    expect(r).toMatchObject({ kind: "handled", notice: expect.stringContaining("$lint") });
  });

  it("plain text is untouched", async () => {
    const a = ctx();
    expect(await resolveCodexInput("hello", a.ctx)).toEqual({ kind: "turn", input: [{ type: "text", text: "hello", text_elements: [] }] });
    expect(a.request).not.toHaveBeenCalled();
  });
});
