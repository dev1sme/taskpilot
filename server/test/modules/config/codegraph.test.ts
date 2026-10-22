import { describe, expect, it } from "vitest";
import { parseCodegraphStatus, stripMakeNoise } from "../../../src/modules/config/codegraph/status.js";

const SAMPLE = `make: Entering directory '/home/thomson/dev/environments'

CodeGraph Status

Project: /home/thomson/dev/project/dev1sme/taskpilot

Index Statistics:
  Files:     273
  Nodes:     3,909
  Edges:     11,220
  DB Size:   15.31 MB
  WAL Size:  0.01 MB
  Backend:   node:sqlite — built-in (full WAL)
  Journal:   wal

Nodes by Kind:
  import          1,270
  function        847

Files by Language:
  typescript      217

✓ Index is up to date

make: Leaving directory '/home/thomson/dev/environments'
`;

describe("parseCodegraphStatus", () => {
  it("reads every field from a full status output", () => {
    expect(parseCodegraphStatus(SAMPLE)).toEqual({
      files: 273,
      nodes: 3909,
      edges: 11220,
      dbSize: "15.31 MB",
      upToDate: true,
    });
  });

  it("reports upToDate false when the index is not current", () => {
    const stale = SAMPLE.replace("✓ Index is up to date", "⚠ Index is out of date (3 files changed)");
    expect(parseCodegraphStatus(stale)?.upToDate).toBe(false);
  });

  it("returns null when a required field is missing", () => {
    expect(parseCodegraphStatus(SAMPLE.replace(/ {2}Edges:.*\n/, ""))).toBeNull();
    expect(parseCodegraphStatus(SAMPLE.replace(/ {2}DB Size:.*\n/, ""))).toBeNull();
  });

  it("returns null when a number is not numeric", () => {
    expect(parseCodegraphStatus(SAMPLE.replace("273", "many"))).toBeNull();
  });

  it("returns null for empty or unrelated output", () => {
    expect(parseCodegraphStatus("")).toBeNull();
    expect(parseCodegraphStatus("thieu p=<duong-dan-tuong-doi>")).toBeNull();
  });
});

describe("stripMakeNoise", () => {
  it("removes make Entering/Leaving lines and surrounding blank lines", () => {
    const out = stripMakeNoise(SAMPLE);
    expect(out).not.toMatch(/make:/);
    expect(out.startsWith("CodeGraph Status")).toBe(true);
    expect(out.endsWith("✓ Index is up to date")).toBe(true);
  });

  it("also removes the recursive make[N] form", () => {
    expect(stripMakeNoise("make[1]: Entering directory '/x'\nhello\nmake[1]: Leaving directory '/x'\n")).toBe("hello");
  });

  it("returns an empty string for empty input", () => {
    expect(stripMakeNoise("")).toBe("");
  });
});
