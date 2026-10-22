import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Where Vietnamese text is expected: the resources, and the task log wording (a document, not UI), and the column names of the plan's assignment table. */
const ALLOWED = [
  "client/src/i18n/",
  "server/src/core/locales/",
  "server/src/modules/workflow/history.ts",
  "server/src/modules/workflow/prompt-text.ts",
  "server/src/modules/workflow/assignments.ts",
];

/** Lines that hold Vietnamese letters as data rather than text: here, patterns matching what Claude writes. */
const ALLOWED_LINES = [/\.replace\(\/đ\/g, "d"\)/, /^const [A-Z_]+ = \/.*\/i;$/];

// Vietnamese letters with diacritics; plain ASCII words are covered by `npm run i18n:lint` for JSX.
const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)))
    .filter((f) => !ALLOWED.some((a) => f.startsWith(a)));
}

describe("UI strings", () => {
  it("live in the i18n resources, not inline in client or server code", async () => {
    const found: string[] = [];
    for (const file of [...(await sources("client/src")), ...(await sources("server/src"))]) {
      const lines = (await readFile(path.join(ROOT, file), "utf8")).split("\n");
      lines.forEach((line, i) => {
        // Trailing comments are fine; strip them before looking.
        const code = line.replace(/\s\/\/ .*$/, "");
        if (COMMENT.test(line) || !VIETNAMESE.test(code) || ALLOWED_LINES.some((re) => re.test(line))) return;
        found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
