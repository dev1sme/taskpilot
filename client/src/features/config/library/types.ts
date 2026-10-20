export type LibraryKind = "agents" | "commands" | "skills";

export interface LibraryItem {
  kind: LibraryKind;
  scope: "project" | "user";
  name: string;
  path: string;
  rel: string;
  description: string;
  fields: Array<{ key: string; value: string }>;
  body: string;
  mtime: number | null;
  error?: string;
  files?: string[];
}
