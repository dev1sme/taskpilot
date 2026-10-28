import { t } from "../../core/i18n.js";
import type { SessionFailure } from "./types.js";

export function unknownFailure(): SessionFailure {
  return { reason: "unknown", message: t("failure.unknown"), observedAt: Date.now(), evidence: { source: "unclassified" } };
}
