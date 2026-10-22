import { ArrowClockwise, Plugs, TreeStructure } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "../../../shared/api/queryClient";
import { useWorkspace } from "../../workspace";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/ui/Toast";
import { McpForm } from "../mcp/McpForm";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "../shared/parts";
import { useConfig } from "../shared/useConfig";
import { codegraphApi } from "./api";
import { mcpApi } from "../mcp/api";
import "./codegraph.css";

type Adding = { baseHash: string } | null;

/** Codegraph index status for the open repo, driven by environments' `make cg-status`/`cg-index`. */
export function CodegraphPage() {
  const { t } = useTranslation("config");
  const { data: status, error, loading, reload } = useConfig(["codegraph"], codegraphApi.codegraph);
  const { repo, inventory, reloadInventory } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);

  const index = async () => {
    setBusy(true);
    try {
      await codegraphApi.codegraphIndex();
      setIndexError(null);
    } catch (e) {
      setIndexError((e as Error).message);
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const hasMcp = inventory?.mcp.servers.some((s) => s.name === "codegraph") ?? false;

  const startAddMcp = async () => {
    try {
      const { hash } = await mcpApi.mcpAddHash("project");
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
          <div className="cg-stack">
            <section className="card">
              <header className="cg-head">
                <TreeStructure weight="fill" aria-hidden="true" />
                <h2>{status.indexed ? t("codegraph.indexed") : t("codegraph.notIndexed")}</h2>
              </header>
              {status.error && (
                <p className="error" role="alert">
                  {status.error}
                </p>
              )}
              {status.summary && (
                <dl className="cg-stats">
                  {(
                    [
                      ["files", status.summary.files.toLocaleString()],
                      ["nodes", status.summary.nodes.toLocaleString()],
                      ["edges", status.summary.edges.toLocaleString()],
                      ["dbSize", status.summary.dbSize],
                    ] as const
                  ).map(([key, value]) => (
                    <div className="cg-stat" key={key}>
                      <dt>{t(`codegraph.stat.${key}`)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                  <div className="cg-stat">
                    <dt>{t("codegraph.stat.state")}</dt>
                    <dd>{status.summary.upToDate ? t("codegraph.upToDate") : t("codegraph.stale")}</dd>
                  </div>
                </dl>
              )}
              {status.detail && (
                <details className="cg-raw">
                  <summary>{t("codegraph.details")}</summary>
                  <pre className="mono">{status.detail}</pre>
                </details>
              )}
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
              <section className="card">
                <header className="cg-head">
                  <Plugs weight="fill" aria-hidden="true" />
                  <h2>{t("codegraph.mcpTitle")}</h2>
                </header>
                {hasMcp ? (
                  <p className="hint">{t("codegraph.mcpPresent")}</p>
                ) : (
                  <>
                    <p className="hint">{t("codegraph.mcpHint")}</p>
                    <Button icon={Plugs} title={t("codegraph.mcpAddTitle")} onClick={() => void startAddMcp()}>
                      {t("codegraph.mcpAdd")}
                    </Button>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
