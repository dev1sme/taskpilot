export interface CodegraphSummary {
  files: number;
  nodes: number;
  edges: number;
  dbSize: string;
  upToDate: boolean;
}

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
  /** Parsed key numbers; null when `detail` has an unknown shape. */
  summary: CodegraphSummary | null;
  error: string | null;
}
