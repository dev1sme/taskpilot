export interface CodegraphSummary {
  files: number;
  nodes: number;
  edges: number;
  dbSize: string;
  /** null when the output says neither "up to date" nor "out of date". */
  upToDate: boolean | null;
}

export interface CodegraphStatus {
  supported: boolean;
  indexed: boolean;
  detail: string | null;
  /** Key numbers parsed from `detail`; null when the output has no recognisable shape (raw `detail` still returned). */
  summary: CodegraphSummary | null;
  error: string | null;
}
