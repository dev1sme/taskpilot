import { CodexError } from "../../../core/codex/errors.js";
import { HttpError } from "../../../core/errors.js";
import { t } from "../../../core/i18n.js";

export function codexHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof CodexError) {
    switch (error.code) {
      case "missing":
        return new HttpError(503, t("codex.missing"));
      case "notLoggedIn":
        return new HttpError(400, t("codex.notLoggedIn"));
      case "modelUnknown":
        return new HttpError(400, t("codex.modelUnknown", { detail }));
      case "protocol":
        return new HttpError(502, t("codex.protocol", { detail }));
      case "modeUnsupported":
        return new HttpError(400, t("codex.modeUnsupported"));
      case "subagentUnsupported":
        return new HttpError(400, t("codex.subagentUnsupported"));
      case "noThread":
        return new HttpError(409, t("codex.noThread"));
    }
  }
  return new HttpError(502, t("codex.failed", { detail }));
}
