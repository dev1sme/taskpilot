import { call } from "../../../shared/api/http";
import type { CodegraphStatus } from "./types";

export const codegraphApi = {
  codegraph: () => call<CodegraphStatus>("GET", "/api/config/codegraph"),
  codegraphIndex: () => call<{ ok: true; output: string }>("POST", "/api/config/codegraph/index", {}),
};
