import type { Scope } from "../shared/types";

export interface MemoryFile {
  scope: Scope;
  path: string;
  exists: boolean;
  content: string;
  lines: number;
  bytes: number;
  mtime: number | null;
  headings: Array<{ level: number; text: string; line: number }>;
  imports: Array<{ ref: string; path: string; exists: boolean; bytes: number; depth: number; line: number }>;
  checks: Array<{ level: "ok" | "warn"; message: string; line?: number }>;
}
