import { ArrowClockwise, TreeStructure } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "../../api/client";
import { Button } from "../../components/Button";
import { ConfigHeader, EmptyCard, LoadError } from "./parts";
import { useConfig } from "./useConfig";

/** Codegraph index status for the open repo, driven by environments' `make cg-status`/`cg-index`. */
export function CodegraphPage() {
  const { data: status, error, loading, reload } = useConfig(["codegraph"], api.codegraph);
  const [busy, setBusy] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);

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

  return (
    <div className="page">
      <ConfigHeader
        title="Codegraph"
        subtitle="Index code cho repo này qua codegraph (container trong environments)"
        loading={loading}
        onReload={() => void reload()}
      />
      <LoadError error={error} />
      <div className="page-body">
        {status && !status.supported && (
          <EmptyCard title="Repo ngoài PROJECTS_ROOT">
            Codegraph chỉ thấy repo nằm trong PROJECTS_ROOT của environments (bind-mount cố định). Repo này nằm ngoài đó nên
            không index được từ TaskPilot.
          </EmptyCard>
        )}
        {status && status.supported && (
          <section className="card hook-group">
            <header className="hook-head">
              <TreeStructure weight="fill" aria-hidden="true" />
              <h2>{status.indexed ? "Đã index" : "Chưa index"}</h2>
            </header>
            {status.error && (
              <p className="error" role="alert">
                {status.error}
              </p>
            )}
            {status.detail && <pre className="mono hook-command">{status.detail}</pre>}
            {!status.indexed && !status.error && <p className="hint">Chưa có .codegraph cho repo này.</p>}
            {indexError && (
              <p className="error" role="alert">
                {indexError}
              </p>
            )}
            <Button icon={ArrowClockwise} busy={busy} disabled={busy} onClick={() => void index()}>
              {status.indexed ? "Re-index" : "Index ngay"}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
