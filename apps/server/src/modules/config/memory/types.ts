export type MemoryScope = "project" | "local" | "user";

export interface MemoryImport {
  ref: string;
  path: string;
  exists: boolean;
  bytes: number;
  depth: number;
  line: number;
}

export interface MemoryFile {
  scope: MemoryScope;
  path: string;
  exists: boolean;
  content: string;
  lines: number;
  bytes: number;
  mtime: number | null;
  headings: Array<{ level: number; text: string; line: number }>;
  imports: MemoryImport[];
  checks: MemoryCheck[];
}

export interface MemoryCheck {
  level: "ok" | "warn";
  message: string;
  line?: number;
}
