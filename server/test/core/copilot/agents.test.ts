import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopilotAgentError, listCopilotAgents, readCopilotAgent } from "../../../src/core/copilot/agents.js";

let root: string;
let repo: string;
let home: string;
let savedHome: string | undefined;

function put(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "copilot-agents-"));
  repo = path.join(root, "repo");
  home = path.join(root, "home");
  mkdirSync(repo);
  savedHome = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.COPILOT_HOME;
  else process.env.COPILOT_HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

describe("readCopilotAgent", () => {
  it("reads description and model from the frontmatter", () => {
    put(path.join(repo, ".github/agents/rev.agent.md"), '---\nname: rev\ndescription: "Reviews diffs"\nmodel: gpt-5\n---\nbody');
    expect(readCopilotAgent(repo, "rev")).toMatchObject({ name: "rev", scope: "project", description: "Reviews diffs", model: "gpt-5" });
  });

  it("finds agents in .claude/agents and in the user directory", () => {
    put(path.join(repo, ".claude/agents/exp.md"), "no frontmatter");
    put(path.join(home, "agents/mine.agent.md"), "---\ndescription: mine\n---\n");
    expect(readCopilotAgent(repo, "exp")).toMatchObject({ scope: "project" });
    expect(readCopilotAgent(repo, "mine")).toMatchObject({ scope: "user", description: "mine" });
  });

  it("does not read ~/.copilot/agents/*.md without the .agent suffix", () => {
    put(path.join(home, "agents/plain.md"), "x");
    expect(() => readCopilotAgent(repo, "plain")).toThrow(expect.objectContaining({ code: "notFound" }));
  });

  it("rejects missing and path-like names", () => {
    expect(() => readCopilotAgent(repo, "ghost")).toThrow(CopilotAgentError);
    expect(() => readCopilotAgent(repo, "../x")).toThrow(expect.objectContaining({ code: "invalidName" }));
  });
});

describe("listCopilotAgents", () => {
  it("lists every location sorted, project winning over user", () => {
    put(path.join(repo, ".github/agents/b.agent.md"), "---\ndescription: project b\n---\n");
    put(path.join(repo, ".claude/agents/a.md"), "");
    put(path.join(home, "agents/b.agent.md"), "---\ndescription: user b\n---\n");
    put(path.join(home, "agents/c.agent.md"), "");
    put(path.join(home, "agents/ignored.md"), "");
    const list = listCopilotAgents(repo);
    expect(list.map((a) => a.name)).toEqual(["a", "b", "c"]);
    expect(list[1]).toMatchObject({ scope: "project", description: "project b" });
  });

  it("returns an empty list when no directory exists", () => {
    expect(listCopilotAgents(repo)).toEqual([]);
  });
});
