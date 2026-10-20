import type { FastifyInstance } from "fastify";
import { HttpError } from "../../core/errors.js";
import { t } from "../../core/i18n.js";
import type { EnvStore } from "./store.js";

/** TaskPilot env store: keys only are listed, values are write-only. */
export function registerEnvRoutes(app: FastifyInstance, opts: { requireRepo: () => string; envStore: EnvStore }) {
  const { requireRepo, envStore } = opts;

  app.get("/api/env", async () => Object.keys(await envStore.forRepo(requireRepo())).map((key) => ({ key })));

  app.put<{ Params: { key: string }; Body: { value?: unknown } }>("/api/env/:key", async (req) => {
    if (typeof req.body?.value !== "string" || !req.body.value) throw new HttpError(400, t("errors.missingValue"));
    await envStore.set(requireRepo(), req.params.key, req.body.value);
    return { ok: true };
  });

  app.delete<{ Params: { key: string } }>("/api/env/:key", async (req) => {
    await envStore.remove(requireRepo(), req.params.key);
    return { ok: true };
  });
}
