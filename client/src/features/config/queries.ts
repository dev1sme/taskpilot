import type { ConfigCapabilitiesView, ConfigScope, ProviderId, RawFileView, RawPreview } from "@server/api-types";
import { useQuery } from "@tanstack/react-query";
import { call, query } from "@/lib/api";
import { useRepo } from "@/features/workspace/queries";

/** One native config file: the CLI, the section, the scope and, for items, its name. */
export interface RawAddress {
  cli: ProviderId;
  section: string;
  scope: ConfigScope;
  name?: string;
}

export const rawApi = {
  read: (a: RawAddress) => call<RawFileView>("GET", `/api/config/raw${query({ cli: a.cli, section: a.section, scope: a.scope, name: a.name })}`),
  preview: (a: RawAddress, content: string, baseHash: string) => call<RawPreview>("POST", "/api/config/raw/preview", { ...a, content, baseHash }),
  save: (a: RawAddress, content: string, baseHash: string) => call<{ hash: string }>("PUT", "/api/config/raw", { ...a, content, baseHash }),
  remove: (a: RawAddress, baseHash: string) => call<{ hash: string }>("DELETE", `/api/config/raw${query({ cli: a.cli, section: a.section, scope: a.scope, name: a.name, baseHash })}`),
};

export function useCapabilities(cli: ProviderId) {
  const repo = useRepo().data?.path;
  return useQuery({ queryKey: ["config-capabilities", repo, cli], queryFn: () => call<ConfigCapabilitiesView>("GET", `/api/config/capabilities${query({ cli })}`), enabled: Boolean(repo) });
}

/** A structured read of one section for one CLI (the "Giao diện" view). */
export function useSection<T>(section: string, cli: ProviderId) {
  const repo = useRepo().data?.path;
  return useQuery({ queryKey: ["config", section, repo, cli], queryFn: () => call<T>("GET", `/api/config/${section}${query({ cli })}`), enabled: Boolean(repo) });
}

export const rawKey = (a: RawAddress) => ["raw", a.cli, a.section, a.scope, a.name ?? ""];
