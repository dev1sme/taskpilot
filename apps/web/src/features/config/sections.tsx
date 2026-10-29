import type { ConfigScope, HookEntry, HookFile, LibraryItem, McpConfig, MemoryFile, NativeSettingsFile, ProviderId, SettingsFile } from "@taskpilot/server/api-types";
import { CheckCircle, PencilSimple, Warning, WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { ScopeBadge } from "@/components/scope-badge";
import { Button } from "@/components/ui/button";
import { useSection } from "./queries";

type EditRaw = (scope: ConfigScope, name?: string) => void;
type Section = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "mcp";

/** The read-only view of one section; every file or item links to its raw file. */
export function SectionView({ section, cli, onEditRaw }: { section: Section; cli: ProviderId; onEditRaw: EditRaw }) {
  switch (section) {
    case "memory":
      return <MemoryView cli={cli} />;
    case "settings":
      return <SettingsView cli={cli} />;
    case "hooks":
      return <HooksView cli={cli} />;
    case "mcp":
      return <McpView cli={cli} onEditRaw={onEditRaw} />;
    default:
      return <LibraryView kind={section} cli={cli} onEditRaw={onEditRaw} />;
  }
}

function Loading({ error, children }: { error: Error | null; children: ReactNode }) {
  const { t } = useTranslation("config");
  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        {error.message}
      </p>
    );
  return children ?? <p className="text-sm text-muted">{t("loading")}</p>;
}

/** One file of the section: its scope, path and an edit link. */
function FileCard({ scope, path, exists, onEdit, children, error }: { scope: ConfigScope; path: string; exists: boolean; onEdit?: () => void; children?: ReactNode; error?: string }) {
  const { t } = useTranslation("config");
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <ScopeBadge scope={scope} />
        <code className="min-w-0 flex-1 truncate bg-transparent px-0 text-sm">{path}</code>
        {!exists && <span className="text-xs text-faint">{t("missing")}</span>}
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <PencilSimple aria-hidden />
            {t("editRaw")}
          </Button>
        )}
      </header>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {children}
    </section>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-faint">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <code key={item}>{item}</code>
        ))}
      </div>
    </div>
  );
}

function MemoryView({ cli }: { cli: ProviderId }) {
  const { t } = useTranslation("config");
  const query = useSection<MemoryFile[]>("memory", cli);
  return (
    <Loading error={query.error}>
      {query.data && (
        <div className="grid gap-4">
          {query.data.map((file) => (
            <FileCard key={file.scope} scope={file.scope} path={file.path} exists={file.exists}>
              {file.exists && (
                <>
                  <p className="text-xs text-muted">{t("memory.lines", { count: file.lines })}</p>
                  <ul className="grid gap-1">
                    {file.checks.map((check, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm">
                        {check.level === "ok" ? (
                          <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-done" aria-hidden />
                        ) : (
                          <Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden />
                        )}
                        <span>
                          {check.message}
                          {check.line !== undefined && <span className="ml-1 font-mono text-xs text-faint">:{check.line}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {file.imports.length > 0 && <Chips label={t("memory.imports")} items={file.imports.map((i) => (i.exists ? i.path : `${i.path} (${t("memory.importMissing")})`))} />}
                  <details className="rounded-sm border border-line">
                    <summary className="flex min-h-9 items-center px-3 text-sm font-medium">{t("memory.content")}</summary>
                    <div className="max-h-[32rem] overflow-auto border-t border-line px-4 py-3">
                      <Markdown source={file.content} />
                    </div>
                  </details>
                </>
              )}
            </FileCard>
          ))}
        </div>
      )}
    </Loading>
  );
}

function SettingsView({ cli }: { cli: ProviderId }) {
  const { t } = useTranslation("config");
  const query = useSection<Array<SettingsFile | NativeSettingsFile>>("settings", cli);
  return (
    <Loading error={query.error}>
      {query.data && (
        <div className="grid gap-4">
          {query.data.map((file) => (
            <FileCard key={file.scope} scope={file.scope} path={file.path} exists={file.exists} error={file.error}>
              {"fields" in file ? (
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  {Object.entries(file.fields).map(([key, value]) => (
                    <div key={key} className="flex flex-wrap gap-2">
                      <dt className="font-mono text-xs text-faint">{key}</dt>
                      <dd className="font-mono text-xs">{value === null ? t("settings.notSet") : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                file.exists && (
                  <div className="grid gap-3">
                    {file.defaultMode && (
                      <p className="text-sm">
                        <span className="text-faint">{t("settings.defaultMode")}:</span> <code>{file.defaultMode}</code>
                      </p>
                    )}
                    <Chips label={t("settings.allow")} items={file.allow} />
                    <Chips label={t("settings.ask")} items={file.ask} />
                    <Chips label={t("settings.deny")} items={file.deny} />
                    <Chips label={t("settings.dirs")} items={file.additionalDirectories} />
                    <Chips label={t("settings.env")} items={file.env.map((e) => `${e.key}=${e.value}`)} />
                    <Chips label={t("settings.other")} items={file.otherKeys} />
                  </div>
                )
              )}
            </FileCard>
          ))}
        </div>
      )}
    </Loading>
  );
}

function HooksView({ cli }: { cli: ProviderId }) {
  const { t } = useTranslation("config");
  const query = useSection<Array<HookEntry | HookFile>>("hooks", cli);
  const data = query.data;
  if (data && cli === "copilot") {
    const files = data as HookFile[];
    return files.length === 0 ? (
      <p className="text-sm text-muted">{t("hooks.none")}</p>
    ) : (
      <div className="grid gap-4">
        {files.map((file) => (
          <FileCard key={`${file.scope}:${file.name}`} scope={file.scope} path={file.path} exists error={file.error}>
            <HookTable
              rows={file.hooks.map((h) => ({
                event: h.event,
                matcher: h.matcher ?? "*",
                command: h.command ?? h.bash ?? h.powershell ?? [h.exec, ...(h.args ?? [])].join(" "),
                timeout: h.timeoutSec,
              }))}
            />
          </FileCard>
        ))}
      </div>
    );
  }
  const entries = (data ?? []) as HookEntry[];
  const byScope = new Map<string, HookEntry[]>();
  for (const entry of entries) byScope.set(`${entry.scope}\0${entry.file}`, [...(byScope.get(`${entry.scope}\0${entry.file}`) ?? []), entry]);
  return (
    <Loading error={query.error}>
      {data &&
        (entries.length === 0 ? (
          <p className="text-sm text-muted">{t("hooks.none")}</p>
        ) : (
          <div className="grid gap-4">
            {[...byScope.values()].map((rows) => (
              <FileCard key={rows[0].file} scope={rows[0].scope} path={rows[0].file} exists>
                <HookTable rows={rows} />
              </FileCard>
            ))}
          </div>
        ))}
    </Loading>
  );
}

function HookTable({ rows }: { rows: Array<{ event: string; matcher: string; command: string; timeout?: number }> }) {
  const { t } = useTranslation("config");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-faint">
          <tr>
            <th className="py-1 pr-3 font-medium">{t("hooks.event")}</th>
            <th className="py-1 pr-3 font-medium">{t("hooks.matcher")}</th>
            <th className="py-1 pr-3 font-medium">{t("hooks.command")}</th>
            <th className="py-1 font-medium">{t("hooks.timeout")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="py-1.5 pr-3 font-mono text-xs">{row.event}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">{row.matcher}</td>
              <td className="py-1.5 pr-3 font-mono text-xs break-all">{row.command}</td>
              <td className="py-1.5 font-mono text-xs">{row.timeout ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LibraryView({ kind, cli, onEditRaw }: { kind: "agents" | "commands" | "skills"; cli: ProviderId; onEditRaw: EditRaw }) {
  const { t } = useTranslation("config");
  const query = useSection<LibraryItem[]>(kind, cli);
  return (
    <Loading error={query.error}>
      {query.data &&
        (query.data.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="grid gap-2">
            {query.data.map((item) => (
              <li key={`${item.scope}:${item.path}`} className="grid gap-1.5 rounded-md border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{item.name}</span>
                  <ScopeBadge scope={item.scope} />
                  {item.check && (
                    <Badge tone={item.check.status === "ok" ? "done" : item.check.status === "error" ? "danger" : "attention"}>
                      {item.check.status === "ok" ? <CheckCircle weight="fill" aria-hidden /> : <WarningCircle weight="fill" aria-hidden />}
                      {t(`library.check.${item.check.status}`)}
                    </Badge>
                  )}
                  <span className="ml-auto" />
                  {item.editable === false ? (
                    <span className="text-xs text-faint">{t("library.readOnly")}</span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onEditRaw(item.scope, item.rel)}>
                      <PencilSimple aria-hidden />
                      {t("editRaw")}
                    </Button>
                  )}
                </div>
                <code className="truncate bg-transparent px-0 text-xs text-faint">{item.path}</code>
                {item.description && <p className="text-sm text-muted">{item.description}</p>}
                {item.fields.length > 0 && (
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {item.fields.map((f) => (
                      <span key={f.key}>
                        {f.key}: <code>{f.value}</code>
                      </span>
                    ))}
                  </p>
                )}
                {item.files && item.files.length > 0 && <p className="text-xs text-faint">{t("library.files", { count: item.files.length })}</p>}
                {item.error && (
                  <p role="alert" className="text-sm text-danger">
                    {item.error}
                  </p>
                )}
                {item.check?.problems?.map((problem, i) => (
                  <p key={i} className="text-xs text-attention">
                    {problem}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ))}
    </Loading>
  );
}

function McpView({ cli, onEditRaw }: { cli: ProviderId; onEditRaw: EditRaw }) {
  const { t } = useTranslation("config");
  const query = useSection<McpConfig>("mcp", cli);
  const data = query.data;
  return (
    <Loading error={query.error}>
      {data && (
        <div className="grid gap-4">
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">{t("mcp.sources")}</h2>
            <ul className="grid gap-1">
              {data.sources.map((source) => (
                <li key={`${source.scope}:${source.path}`} className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface px-3 py-2">
                  <ScopeBadge scope={source.scope} />
                  <code className="min-w-0 flex-1 truncate bg-transparent px-0 text-sm">{source.path}</code>
                  {!source.exists && <span className="text-xs text-faint">{t("missing")}</span>}
                  {source.error && <span className="text-xs text-danger">{source.error}</span>}
                  {!(cli === "claude" && source.scope !== "project") && (
                    <Button size="sm" variant="ghost" onClick={() => onEditRaw(source.scope)}>
                      <PencilSimple aria-hidden />
                      {t("editRaw")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold">{t("mcp.servers")}</h2>
            {data.servers.length === 0 ? (
              <p className="text-sm text-muted">{t("empty")}</p>
            ) : (
              <ul className="grid gap-2">
                {data.servers.map((server) => (
                  <li key={`${server.scope}:${server.source ?? ""}:${server.name}`} className="grid gap-1.5 rounded-md border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{server.name}</span>
                      <Badge>{server.type}</Badge>
                      <ScopeBadge scope={server.scope} />
                      {server.effective === false && <Badge tone="attention">{t("mcp.shadowed")}</Badge>}
                    </div>
                    <code className="bg-transparent px-0 text-xs break-all text-muted">{server.url ?? [server.command, ...server.args].filter(Boolean).join(" ")}</code>
                    {server.env.length > 0 && <Chips label={t("settings.env")} items={server.env.map((e) => `${e.key}=${e.value}`)} />}
                    {server.missingEnv.length > 0 && <p className="text-xs text-attention">{t("mcp.missingEnv", { list: server.missingEnv.join(", ") })}</p>}
                    {server.fromTaskPilot.length > 0 && <p className="text-xs text-muted">{t("mcp.fromTaskPilot", { list: server.fromTaskPilot.join(", ") })}</p>}
                    {server.error && (
                      <p role="alert" className="text-xs text-danger">
                        {server.error}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Loading>
  );
}
