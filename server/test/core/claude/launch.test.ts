import { describe, expect, it } from "vitest";
import { childEnv } from "../../../src/core/claude/launch.js";

describe("childEnv", () => {
  it("drops CLAUDE* variables so the child writes its transcript", () => {
    const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", HOME: "/h" });
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h" });
    expect(Object.keys(env).filter((k) => k.startsWith("CLAUDE"))).toEqual([]);
  });
});
