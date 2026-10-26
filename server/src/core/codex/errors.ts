/** A failed Codex step; `code` tells the caller which message to show (the backend maps it to a message in core/locales). */
export class CodexError extends Error {
  constructor(
    readonly code: "missing" | "protocol" | "modeUnsupported" | "subagentUnsupported" | "noThread" | "closed" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

/** The app-server answered a request with a JSON-RPC error (resume of an unknown thread is -32600). */
export class RpcError extends Error {
  constructor(
    readonly rpcCode: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}
