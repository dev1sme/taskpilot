import type { ConfigScope, ProviderId } from "@server/api-types";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { rememberConfigCli, type ConfigSection } from "@/app/routes";
import { useCapabilities } from "./queries";
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
            {view === "raw" && scopes.length > 1 && (
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
          ) : scope ? (
            <RawView section={section} cli={cli} scope={scope} name={search.name} onName={(name) => go({ name })} />
          ) : null}
        </div>
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

function NamePicker({ onName }: { onName: (name: string) => void }) {
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
        <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("raw.name")} placeholder="reviewer.md" spellCheck={false} />
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
