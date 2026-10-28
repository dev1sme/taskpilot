import type { CodegraphStatus } from "@server/api-types";
import { ArrowClockwise, CheckCircle, Warning } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useRepo } from "@/features/workspace/queries";

const codegraphApi = {
  status: () => call<CodegraphStatus>("GET", "/api/config/codegraph"),
  index: () => call<{ ok: true; output: string }>("POST", "/api/config/codegraph/index"),
};

/** The repo's codegraph index: its numbers, the raw status, and a button to (re)index. */
export function CodegraphPage() {
  const { t } = useTranslation("config");
  const repo = useRepo().data?.path;
  const status = useQuery({ queryKey: ["codegraph", repo], queryFn: codegraphApi.status, enabled: Boolean(repo) });
  const index = useMutation({
    mutationFn: codegraphApi.index,
    onSuccess: () => {
      toast.success(t("codegraph.indexed"));
      void queryClient.invalidateQueries({ queryKey: ["codegraph"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const data = status.data;
  const indexButton = data?.supported && (
    <Button variant={data.indexed ? "secondary" : "primary"} busy={index.isPending} onClick={() => index.mutate()}>
      <ArrowClockwise aria-hidden />
      {data.indexed ? t("codegraph.index") : t("codegraph.indexFirst")}
    </Button>
  );

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={t("codegraph.title")} subtitle={t("codegraph.subtitle")} actions={indexButton} />
      <div className="grid max-w-4xl gap-4 px-4 py-4 sm:px-6">
        {status.error ? (
          <EmptyState title={status.error.message} />
        ) : !data ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : !data.supported ? (
          <EmptyState title={t("codegraph.unsupported")} />
        ) : !data.indexed ? (
          <EmptyState title={t("codegraph.notIndexed")} action={indexButton} />
        ) : (
          <>
            {data.error && (
              <p role="alert" className="rounded-sm border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
                {t("codegraph.error", { error: data.error })}
              </p>
            )}
            {data.summary && <Summary summary={data.summary} />}
            {data.detail && (
              <section className="grid gap-2">
                <h2 className="text-sm font-semibold">{t("codegraph.detail")}</h2>
                <pre className="overflow-auto rounded-sm border border-line bg-sunken p-3 font-mono text-xs leading-relaxed">{data.detail}</pre>
              </section>
            )}
          </>
        )}
        {index.isPending && (
          <p role="status" className="text-sm text-muted">
            {t("codegraph.indexing")}
          </p>
        )}
        {index.data?.output && (
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">{t("codegraph.output")}</h2>
            <pre className="max-h-[40vh] overflow-auto rounded-sm border border-line bg-sunken p-3 font-mono text-xs leading-relaxed">{index.data.output}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

function Summary({ summary }: { summary: NonNullable<CodegraphStatus["summary"]> }) {
  const { t, i18n } = useTranslation("config");
  const number = (n: number) => n.toLocaleString(i18n.language);
  const stats: Array<[string, string]> = [
    [t("codegraph.files"), number(summary.files)],
    [t("codegraph.nodes"), number(summary.nodes)],
    [t("codegraph.edges"), number(summary.edges)],
    [t("codegraph.dbSize"), summary.dbSize],
  ];
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
      {summary.upToDate !== null && (
        <div>
          {summary.upToDate ? (
            <Badge tone="done">
              <CheckCircle weight="fill" aria-hidden />
              {t("codegraph.upToDate")}
            </Badge>
          ) : (
            <Badge tone="attention">
              <Warning weight="fill" aria-hidden />
              {t("codegraph.outOfDate")}
            </Badge>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-xs text-faint">{label}</dt>
            <dd className="font-mono text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
