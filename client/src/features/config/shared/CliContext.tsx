import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId } from "../../../shared/providers";
import { href, type ConfigSection } from "../../../shared/router";
import { LoadError } from "./ConfigChrome";
import { scopeLabel } from "./ScopeControls";
import type { Scope } from "./types";

export const ConfigCliContext = createContext<ProviderId>("claude");

export const useConfigCli = (): ProviderId => useContext(ConfigCliContext);

export interface SectionCapability {
  scopes: Scope[];
  supported: boolean;
  available: boolean;
  reason?: string;
}

/** The CLI stays in the hash while moving among native configuration pages. */
export function CliSelector({ cli, section }: { cli: ProviderId; section: ConfigSection }) {
  const { t } = useTranslation("shell");
  const clis: ProviderId[] = ["claude", "copilot", "codex"];
  return (
    <nav className="page-tabs" aria-label={t("configSelector.label")}>
      {clis.map((candidate) => (
        <a key={candidate} href={href({ page: "config", section, cli: candidate })} aria-current={candidate === cli ? "page" : undefined}>
          {t(`cli.${candidate}`)}
        </a>
      ))}
    </nav>
  );
}

export function CapabilityNotice({ cli, capability, loading, error }: { cli: ProviderId; capability: SectionCapability | null; loading: boolean; error: string | null }) {
  const { t } = useTranslation("shell");
  return (
    <div className="page-body">
      {error ? (
        <LoadError error={error} />
      ) : loading ? (
        <p className="hint">{t("configSelector.loading")}</p>
      ) : (
        <div className="empty-card">
          <h2>{t(`cli.${cli}`)}</h2>
          <p>{t(capability?.supported ? "configSelector.pendingUi" : "configSelector.unsupported")}</p>
          {capability?.supported && <p>{t("configSelector.scopes", { scopes: capability.scopes.map(scopeLabel).join(", ") })}</p>}
        </div>
      )}
    </div>
  );
}
