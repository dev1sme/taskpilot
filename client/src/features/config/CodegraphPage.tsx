import { ArrowClockwise, Plugs, TreeStructure } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { queryClient } from "../../api/queryClient";
import { useWorkspace } from "../../app/workspace";
import { Button } from "../../components/Button";
import { toast } from "../../components/Toast";
import { McpForm } from "./McpForm";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "./parts";
import { useConfig } from "./useConfig";

type Adding = { baseHash: string } | null;

/** Codegraph index status for the open repo, driven by environments' `make cg-status`/`cg-index`. */
export function CodegraphPage() {
  const { t } = useTranslation("config");
  const { data: status, error, loading, reload } = useConfig(["codegraph"], api.codegraph);
  const { repo, reloadInventory } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);

  const index = async () => {
    setBusy(true);
    try {
      await api.codegraphIndex();
      setIndexError(null);
    } catch (e) {
      setIndexError((e as Error).message);
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const startAddMcp = async () => {
    try {
      const { hash } = await api.mcpAddHash("project");
      setAdding({ baseHash: hash });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <div className="page">
      <ConfigHeader title={t("codegraph.title")} subtitle={t("codegraph.subtitle")} />
      <ConfigToolbar readOnly loading={loading} onReload={() => void reload()} />
      <LoadError error={error} />
      <div className="page-body">
        {status && !status.supported && (
          <EmptyCard title={t("codegraph.outsideTitle")}>{t("codegraph.outsideBody")}</EmptyCard>
        )}
        {status && status.supported && (
          <>
            <section className="card hook-group">
              <header className="hook-head">
                <TreeStructure weight="fill" aria-hidden="true" />
                <h2>{status.indexed ? t("codegraph.indexed") : t("codegraph.notIndexed")}</h2>
              </header>
              {status.error && (
                <p className="error" role="alert">
                  {status.error}
                </p>
              )}
              {status.detail && <pre className="mono hook-command">{status.detail}</pre>}
              {!status.indexed && !status.error && <p className="hint">{t("codegraph.noIndex")}</p>}
              {indexError && (
                <p className="error" role="alert">
                  {indexError}
                </p>
              )}
              <Button icon={ArrowClockwise} busy={busy} disabled={busy} onClick={() => void index()}>
                {status.indexed ? t("codegraph.reindex") : t("codegraph.indexNow")}
              </Button>
            </section>

            {adding ? (
              <McpForm
                scope="project"
                base={null}
                baseHash={adding.baseHash}
                initial={{
                  name: "codegraph",
                  command: "docker",
                  args: ["exec", "-i", "-w", repo?.path ?? "", "env-codegraph", "codegraph", "serve", "--mcp"],
                }}
                onDone={(name) => {
                  setAdding(null);
                  if (name) {
                    void queryClient.invalidateQueries({ queryKey: ["mcp"] });
                    void reloadInventory();
                  }
                }}
              />
            ) : (
              <section className="card hook-group">
                <header className="hook-head">
                  <Plugs weight="fill" aria-hidden="true" />
                  <h2>{t("codegraph.mcpTitle")}</h2>
                </header>
                <p className="hint">{t("codegraph.mcpHint")}</p>
                <Button icon={Plugs} title={t("codegraph.mcpAddTitle")} onClick={() => void startAddMcp()}>
                  {t("codegraph.mcpAdd")}
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
