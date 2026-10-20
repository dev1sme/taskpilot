import { call } from "../../shared/api/http";
import type { UsageView } from "./types";

export const usageApi = {
  usage: () => call<UsageView | null>("GET", "/api/usage"),
};
