import { execFile } from "node:child_process";
import { childEnv } from "./launch.js";

/**
 * Builds a `<file> --version` reader that runs once per server run (the command is resolved on the
 * first call); it yields null when the command is missing, fails or `parse` finds no version.
 */
export function createCliVersionReader(file: () => string, parse: (stdout: string) => string | null): () => Promise<string | null> {
  let cached: Promise<string | null> | null = null;
  return () => {
    cached ??= new Promise((resolve) => {
      execFile(file(), ["--version"], { env: childEnv(), timeout: 10_000 }, (err, stdout) => resolve(err ? null : parse(stdout)));
    });
    return cached;
  };
}
