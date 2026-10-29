import type { ConfigScope, HookFile, ProviderId } from "@taskpilot/server/api-types";
import { CheckCircle, FilePlus } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@taskpilot/shared";
import { cn } from "@/lib/utils";
import { ScopeBadge } from "@/components/scope-badge";
import { rememberConfigCli, type ConfigSection } from "@/app/routes";
import { useCapabilities, useSection } from "./queries";
import { RawFileEditor } from "./raw-editor";
import { SectionView } from "./sections";

type NativeSection = "memory" | "settings" | "hooks" | "agents" | "commands" | "skills" | "mcp";
const LIBRARY: NativeSection[] = ["agents", "commands", "skills"];

export interface ConfigSearch {
  cli?: ProviderId;
  view?: "ui" | "raw";
  scope?: ConfigScope;
  name?: string;
}

/** A CLI's native configuration: a read-only view of a section, or its raw file to edit. */
export function NativeConfigPage({ section, search }: { section: NativeSection; search: ConfigSearch }) {
  const { t } = useTranslation(["config", "shell"]);
  const navigate = useNavigate();
  const cli = search.cli ?? "claude";
  rememberConfigCli(cli);
  const capabilities = useCapabilities(cli);
  const capability = capabilities.data?.sections[section];
  const view = search.view ?? "ui";
  const scopes = capability?.scopes ?? [];
  const scope = search.scope && scopes.includes(search.scope) ? search.scope : scopes[0];
  const go = (next: Partial<ConfigSearch>, to: NativeSection = section) => void navigate({ to: "/config/$section", params: { section: to }, search: { ...search, ...next } });
  const title = t(`shell:nav.${LIBRARY.includes(section) ? "library" : section}`);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title={title}
        actions={
          <nav aria-label={t("cli.label")} className="flex gap-1">
            {PROVIDER_IDS.map((id) => (
              <Link
                key={id}
                to="/config/$section"
                params={{ section }}
                search={{ cli: id, view }}
                aria-current={id === cli ? "page" : undefined}
                className={cn("inline-flex h-8 items-center rounded-sm px-3 text-sm text-muted hover:bg-hover hover:text-ink", id === cli && "bg-signal-soft font-medium text-ink")}
              >
                {PROVIDER_LABELS[id]}
              </Link>
            ))}
          </nav>
        }
      />
      {LIBRARY.includes(section) && (
        <Tabs value={section} onValueChange={(next) => go({ name: undefined }, next as NativeSection)} className="border-b border-line px-4 py-2 sm:px-6">
          <TabsList>
            {LIBRARY.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {t(`shell:nav.${kind}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {capabilities.error ? (
        <EmptyState title={capabilities.error.message} />
      ) : !capabilities.data ? (
        <p className="p-6 text-sm text-muted">{t("loading")}</p>
      ) : !capability?.supported ? (
        <EmptyState title={t("unsupported", { cli: PROVIDER_LABELS[cli] })}>{capability?.reason}</EmptyState>
      ) : (
        <div className="grid gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={view} onValueChange={(next) => go({ view: next as "ui" | "raw" })}>
              <TabsList aria-label={t("view.label")}>
                <TabsTrigger value="ui">{t("view.ui")}</TabsTrigger>
                <TabsTrigger value="raw">{t("view.raw")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {view === "raw" && !["memory", "settings", "hooks"].includes(section) && scopes.length > 1 && (
              <ToggleGroup type="single" value={scope} onValueChange={(next) => next && go({ scope: next as ConfigScope, name: undefined })} aria-label={t("scope.label")}>
                {scopes.map((s) => (
                  <ToggleGroupItem key={s} value={s}>
                    {t(`scope.${s}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </div>
          {view === "ui" ? (
            <SectionView section={section} cli={cli} onEditRaw={(scopeOfItem, name) => go({ view: "raw", scope: scopeOfItem, name })} />
          ) : section === "hooks" && cli === "copilot" ? (
            <HookFilesRawView key={cli} cli={cli} scopes={scopes} requestedScope={search.scope} requestedName={search.name} onPick={(scope, name) => go({ scope, name })} />
          ) : section === "memory" || section === "settings" || section === "hooks" ? (
            <ScopeRawView section={section} cli={cli} scopes={scopes} requestedScope={search.scope} onScope={(scope) => go({ scope, name: undefined })} />
          ) : scope ? (
            <RawView section={section} cli={cli} scope={scope} name={search.name} onName={(name) => go({ name })} />
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ScopeFile {
  scope: ConfigScope;
  path: string;
  exists: boolean;
  count?: number;
}

/** Reuse the same file inventory and selection for memory, settings and hooks. */
function FileScopePicker({
  scopes,
  files,
  value,
  onChange,
  label,
}: {
  scopes: ConfigScope[];
  files: ScopeFile[];
  value?: ConfigScope;
  onChange: (scope: ConfigScope) => void;
  label: string;
}) {
  const { t } = useTranslation("config");
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(value) => value && onChange(value as ConfigScope)}
      aria-label={label}
      className={cn("grid grid-cols-1 items-stretch gap-2", scopes.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}
    >
      {scopes.map((scope) => {
        const file = files.find((file) => file.scope === scope);
        const Icon = file?.exists ? CheckCircle : FilePlus;
        return (
          <ToggleGroupItem
            key={scope}
            value={scope}
            className="h-auto min-h-20 min-w-0 flex-col items-stretch justify-start gap-2 border-line p-3 text-left data-[state=on]:border-signal data-[state=on]:bg-signal-soft"
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <ScopeBadge scope={scope} />
              <span className={cn("flex items-center gap-1 text-xs", file?.exists ? "text-signal-text" : "text-muted")}>
                <Icon size={14} aria-hidden />
                {file?.exists ? (file.count !== undefined ? t("raw.fileCount", { count: file.count }) : t("raw.fileExists")) : t("missing")}
              </span>
            </span>
            {file?.path && <span className="break-all whitespace-pre-line font-mono text-xs text-muted">{file.path}</span>}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function ScopeRawView({
  section,
  cli,
  scopes,
  requestedScope,
  onScope,
}: {
  section: "memory" | "settings" | "hooks";
  cli: ProviderId;
  scopes: ConfigScope[];
  requestedScope?: ConfigScope;
  onScope: (scope: ConfigScope) => void;
}) {
  const { t } = useTranslation("config");
  // Claude hooks live in settings files, even when those files contain no hooks yet.
  const query = useSection<ScopeFile[]>(section === "hooks" ? "settings" : section, cli);
  if (query.error)
    return (
      <p role="alert" className="break-words text-sm text-danger">
        {query.error.message}
      </p>
    );
  if (!query.data) return <p className="text-sm text-muted">{t("loading")}</p>;
  const files = query.data;
  const scope = requestedScope && scopes.includes(requestedScope) ? requestedScope : (files.find((file) => file.exists && scopes.includes(file.scope))?.scope ?? scopes[0]);
  return (
    <div className="grid min-w-0 gap-4">
      {section === "hooks" && <p className="text-sm text-muted">{t("raw.hooksInSettings")}</p>}
      <FileScopePicker
        scopes={scopes}
        files={files}
        value={scope}
        onChange={onScope}
        label={t(section === "memory" ? "raw.memoryFiles" : section === "settings" ? "raw.settingsFiles" : "raw.hookFiles")}
      />
      {scope && <RawFileEditor key={`${cli}:${section}:${scope}`} address={{ cli, section, scope }} />}
    </div>
  );
}

function HookFilesRawView({
  cli,
  scopes,
  requestedScope,
  requestedName,
  onPick,
}: {
  cli: ProviderId;
  scopes: ConfigScope[];
  requestedScope?: ConfigScope;
  requestedName?: string;
  onPick: (scope: ConfigScope, name?: string) => void;
}) {
  const { t } = useTranslation("config");
  const query = useSection<HookFile[]>("hooks", cli);
  const [creating, setCreating] = useState(false);
  if (query.error)
    return (
      <p role="alert" className="break-words text-sm text-danger">
        {query.error.message}
      </p>
    );
  if (!query.data) return <p className="text-sm text-muted">{t("loading")}</p>;
  const files = query.data;
  const scope = requestedScope && scopes.includes(requestedScope) ? requestedScope : (files.find((file) => scopes.includes(file.scope))?.scope ?? scopes[0]);
  const scoped = files.filter((file) => file.scope === scope);
  const name = requestedName ?? scoped[0]?.name;
  if (!scope) return null;
  return (
    <div className="grid min-w-0 gap-4">
      <FileScopePicker
        scopes={scopes}
        files={scopes.map((scope) => {
          const found = files.filter((file) => file.scope === scope);
          return { scope, path: found.map((file) => file.path).join("\n"), exists: found.length > 0, count: found.length };
        })}
        value={scope}
        onChange={(next) => {
          setCreating(false);
          onPick(next);
        }}
        label={t("raw.hookFiles")}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {scoped.length > 0 && (
          <ToggleGroup
            type="single"
            value={creating ? "" : name}
            onValueChange={(next) => {
              if (next) {
                setCreating(false);
                onPick(scope, next);
              }
            }}
            aria-label={t("raw.pickHookFile")}
          >
            {scoped.map((file) => (
              <ToggleGroupItem key={file.name} value={file.name} className="h-auto min-h-11 min-w-0 max-w-full break-all whitespace-normal sm:min-h-9">
                {file.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <Button size="sm" variant="secondary" aria-pressed={creating} onClick={() => setCreating(true)}>
          <FilePlus aria-hidden />
          {t("raw.createFile")}
        </Button>
      </div>
      {creating || !name ? (
        <NamePicker
          placeholder="hooks.json"
          onName={(next) => {
            setCreating(false);
            onPick(scope, next);
          }}
        />
      ) : (
        <RawFileEditor key={`${cli}:hooks:${scope}:${name}`} address={{ cli, section: "hooks", scope, name }} />
      )}
    </div>
  );
}

/** Items of their own (library files, hook sets) need a name; the others are one file per scope. */
function needsName(section: NativeSection, cli: ProviderId): boolean {
  return LIBRARY.includes(section) || (section === "hooks" && cli === "copilot");
}

function RawView({ section, cli, scope, name, onName }: { section: NativeSection; cli: ProviderId; scope: ConfigScope; name?: string; onName: (name: string) => void }) {
  const { t } = useTranslation("config");
  if (section === "mcp" && cli === "claude" && scope !== "project") return <Notice>{t("readOnlyClaudeMcp")}</Notice>;
  if (needsName(section, cli) && !name) return <NamePicker onName={onName} />;
  return <RawFileEditor key={`${cli}:${section}:${scope}:${name ?? ""}`} address={{ cli, section, scope, name }} />;
}

function NamePicker({ onName, placeholder = "reviewer.md" }: { onName: (name: string) => void; placeholder?: string }) {
  const { t } = useTranslation("config");
  const [value, setValue] = useState("");
  return (
    <form
      className="grid max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onName(value.trim());
      }}
    >
      <p className="text-sm text-muted">{t("raw.pick")}</p>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("raw.name")} placeholder={placeholder} spellCheck={false} />
        <Button type="submit" disabled={!value.trim()}>
          {t("raw.open")}
        </Button>
      </div>
    </form>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-sm border border-line bg-surface p-3 text-sm text-muted">{children}</p>;
}

export const isNativeSection = (section: ConfigSection): section is NativeSection => ["memory", "settings", "hooks", "agents", "commands", "skills", "mcp"].includes(section);
