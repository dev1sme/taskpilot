import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

interface Edge {
  from: string;
  to: string;
  /** `import type`, `export type` or every name marked `type`: erased at runtime. */
  typeOnly: boolean;
}

// Static imports and re-exports (any line breaks inside the braces), side-effect imports, dynamic imports.
const STATIC = /^(import|export)\s+(type\s+)?(?:([^;"]*?)\s+from\s+)?"(\.[^"]+)";?/gm;
const DYNAMIC = /import\(\s*"(\.[^"]+)"\s*\)/g;

function allTypes(clause: string | undefined): boolean {
  const names = /\{([\s\S]*)\}/
    .exec(clause ?? "")?.[1]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return !!names?.length && /^\{/.test(clause!.trim()) && names.every((n) => n.startsWith("type "));
}

function resolve(from: string, spec: string): string | null {
  const base = path.join(path.dirname(from), spec);
  const candidates = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  return candidates.find((c) => existsSync(path.join(ROOT, c)) && statSync(path.join(ROOT, c)).isFile()) ?? null;
}

async function edges(dir: string): Promise<{ edges: Edge[]; unresolved: string[] }> {
  const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile() && /\.tsx?$/.test(e.name)).map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)));
  const out: Edge[] = [];
  const unresolved: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT, file), "utf8");
    const add = (spec: string, typeOnly: boolean) => {
      const to = resolve(file, spec);
      if (to) out.push({ from: file, to, typeOnly });
      else unresolved.push(`${file}: ${spec}`);
    };
    for (const m of text.matchAll(STATIC)) add(m[4], !!m[2] || allTypes(m[3]));
    for (const m of text.matchAll(DYNAMIC)) add(m[1], false);
  }
  return { edges: out, unresolved };
}

/** Edges that break `rule`, as "from -> to". */
const breaking = (all: Edge[], rule: (e: Edge) => boolean) => all.filter(rule).map((e) => `${e.from} -> ${e.to}`);

/** Cycles between units (a module or a feature), as "a -> b -> a". */
function cycles(all: Edge[], unitOf: (file: string) => string | null): string[] {
  const graph = new Map<string, Set<string>>();
  for (const e of all) {
    const [a, b] = [unitOf(e.from), unitOf(e.to)];
    if (a && b && a !== b) graph.set(a, (graph.get(a) ?? new Set()).add(b));
  }
  const found = new Set<string>();
  const walk = (unit: string, trail: string[]) => {
    for (const next of graph.get(unit) ?? []) {
      const at = trail.indexOf(next);
      if (at >= 0) {
        const loop = trail.slice(at);
        const start = loop.indexOf([...loop].sort()[0]);
        found.add([...loop.slice(start), ...loop.slice(0, start), loop[start]].join(" -> "));
      } else walk(next, [...trail, next]);
    }
  };
  for (const unit of graph.keys()) walk(unit, [unit]);
  return [...found].sort();
}

const unit = (prefix: string) => (file: string) => (file.startsWith(prefix) ? file.slice(prefix.length).split("/")[0] : null);
const entry = (file: string) => /\/index\.tsx?$/.test(file);

describe("server import boundaries", () => {
  let all: Edge[];
  const moduleOf = unit("server/src/modules/");
  beforeAll(async () => {
    const found = await edges("server/src");
    all = found.edges;
    expect(found.unresolved).toEqual([]);
  });

  it("core uses no module code (types only)", () => {
    expect(breaking(all, (e) => e.from.startsWith("server/src/core/") && !!moduleOf(e.to) && !e.typeOnly)).toEqual([]);
  });

  it("modules, app.ts and index.ts use other modules through their index.ts", () => {
    expect(breaking(all, (e) => !!moduleOf(e.to) && moduleOf(e.from) !== moduleOf(e.to) && !entry(e.to))).toEqual([]);
  });

  it("core and modules import neither app.ts nor index.ts", () => {
    expect(breaking(all, (e) => /^server\/src\/(core|modules)\//.test(e.from) && /^server\/src\/(app|index)\.ts$/.test(e.to))).toEqual([]);
  });

  it("modules have no runtime import cycles", () => {
    expect(
      cycles(
        all.filter((e) => !e.typeOnly),
        moduleOf,
      ),
    ).toEqual([]);
  });
});

describe("client import boundaries", () => {
  let all: Edge[];
  const featureOf = unit("client/src/features/");
  beforeAll(async () => {
    const found = await edges("client/src");
    all = found.edges.filter((e) => !e.to.startsWith("client/src/i18n/locales/"));
    expect(found.unresolved.filter((u) => !/\.(css|json)$/.test(u))).toEqual([]);
  });

  it("shared uses neither features nor app", () => {
    expect(breaking(all, (e) => e.from.startsWith("client/src/shared/") && /^client\/src\/(features|app)\//.test(e.to))).toEqual([]);
  });

  it("features do not use app", () => {
    expect(breaking(all, (e) => e.from.startsWith("client/src/features/") && e.to.startsWith("client/src/app/"))).toEqual([]);
  });

  it("app and other features use a feature through its index.ts", () => {
    expect(breaking(all, (e) => !!featureOf(e.to) && featureOf(e.from) !== featureOf(e.to) && !entry(e.to))).toEqual([]);
  });

  it("features have no import cycles, type-only imports included", () => {
    expect(cycles(all, featureOf)).toEqual([]);
  });
});

describe("client stylesheets", () => {
  it("are imported only from their own feature, app or shared", async () => {
    const entries = await readdir(path.join(ROOT, "client/src"), { withFileTypes: true, recursive: true });
    const found: string[] = [];
    for (const e of entries.filter((x) => x.isFile() && /\.tsx?$/.test(x.name))) {
      const file = path.relative(ROOT, path.join(e.parentPath, e.name));
      const text = await readFile(path.join(ROOT, file), "utf8");
      for (const m of text.matchAll(/^import\s+"(\.[^"]+\.css)";/gm)) {
        const css = path.join(path.dirname(file), m[1]);
        const [from, to] = [unit("client/src/features/")(file), unit("client/src/features/")(css)];
        const shellCss = css.startsWith("client/src/app/") && !file.startsWith("client/src/app/");
        if ((to && from !== to) || shellCss) found.push(`${file} -> ${css}`);
      }
    }
    expect(found).toEqual([]);
  });
});
