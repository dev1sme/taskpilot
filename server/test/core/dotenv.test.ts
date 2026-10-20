import { afterAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDotEnv } from "../../src/core/dotenv.js";
import { cleanupTempDirs, tempDir } from "../helpers/fixtures.js";

afterAll(cleanupTempDirs);

describe("dotenv", () => {
  it("fills unset variables only, skips empty values, ignores a missing file", async () => {
    const file = path.join(await tempDir("taskpilot-env-"), ".env");
    await writeFile(file, "A=from-file\nB=from-file\nC=\n# comment\nD=\"quoted value\"\n");
    const env: NodeJS.ProcessEnv = { B: "from-env" };
    loadDotEnv(file, env);
    expect(env).toEqual({ A: "from-file", B: "from-env", D: "quoted value" });
    expect(() => loadDotEnv(path.join(path.dirname(file), "missing.env"), env)).not.toThrow();
  });
});
