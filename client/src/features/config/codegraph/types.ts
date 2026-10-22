export interface CodegraphSummary {
  files: number;
  nodes: number;
  edges: number;
  dbSize: string;
  /** null when cg-status says neither "up to date" nor "out of date". */
  upToDate: boolean | null;
}

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
  /** Parsed key numbers; null when `detail` has an unknown shape. */
  summary: CodegraphSummary | null;
  error: string | null;
}
