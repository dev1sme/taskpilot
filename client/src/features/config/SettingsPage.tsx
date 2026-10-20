import { Eye, PencilSimple, Plus, Prohibit, Question, ShieldCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api/client";
import type { Scope, SettingsFile } from "../../api/types";
import { Button } from "../../shared/ui/Button";
import { DiffDialog } from "../../shared/ui/DiffDialog";
import { toast } from "../../shared/ui/Toast";
import { getDraft, isDirty, setDraft, useDrafts } from "./drafts";
import { ConfigHeader, ConfigToolbar, DraftControls, LoadError, RuleChip, ScopeTabs, ScopeTag, scopeHint } from "./parts";
import { PermissionsEditor, permissionsKey, usePermissionsSave, type PermissionsDraft } from "./PermissionsEditor";
import { useConfig } from "./useConfig";

/** Modes with a description in `config:settings.modeLabel`. */
const MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const;
const knownMode = (m: string): m is (typeof MODES)[number] => (MODES as readonly string[]).includes(m);

/** Permission rules and env of each settings scope, one file at a time. Deny beats ask beats allow in Claude Code. */
export function SettingsPage() {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["settings"], api.settings);
  const [scope, setScope] = useState<Scope>("project");
  const [opening, setOpening] = useState(false);
  useDrafts();
  const draft = getDraft<PermissionsDraft>(permissionsKey(scope));
  const files = data ?? [];
  const file = files.find((f) => f.scope === scope);
  const totals = files.reduce((n, f) => ({ allow: n.allow + f.allow.length, ask: n.ask + f.ask.length, deny: n.deny + f.deny.length }), { allow: 0, ask: 0, deny: 0 });

  const startEditing = async () => {
    setOpening(true);
    try {
      const p = await api.permissions(scope);
      setDraft(permissionsKey(scope), {
        permissions: { allow: p.allow, ask: p.ask, deny: p.deny, defaultMode: p.defaultMode },
        baseHash: p.hash,
        path: p.path,
      } satisfies PermissionsDraft);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = usePermissionsSave(scope, draft, () => void reload());

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={permissionsKey(scope)} />
      <Button icon={Eye} variant="primary" onClick={() => void flow.review()}>
        {t("action.review")}
      </Button>
    </>
  ) : (
    file &&
    !file.error && (
      <Button
        icon={file.exists ? PencilSimple : Plus}
        variant="primary"
        busy={opening}
        title={t(file.exists ? "settings.editTitle" : "settings.addTitle", { path: file.path })}
        onClick={() => void startEditing()}
      >
        {file.exists ? t("action.edit") : t("action.add")}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={setScope}
            label={t("settings.tabsLabel")}
            labels={{ project: t("settings.tab.project"), local: t("settings.tab.local"), user: t("settings.tab.user") }}
            isMissing={(s) => files.find((f) => f.scope === s)?.exists === false && !getDraft(permissionsKey(s))}
            isDirty={(s) => isDirty(permissionsKey(s))}
          />
        }
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      <div className="page-body settings">
        {data && (
          <div className="totals" aria-label={t("settings.totalsLabel")}>
            <div className="total allow">
              <ShieldCheck weight="fill" aria-hidden="true" />
              <Trans t={t} i18nKey="settings.totals.allow" values={{ count: totals.allow }} components={{ strong: <strong /> }} />
            </div>
            <div className="total ask">
              <Question weight="fill" aria-hidden="true" />
              <Trans t={t} i18nKey="settings.totals.ask" values={{ count: totals.ask }} components={{ strong: <strong /> }} />
            </div>
            <div className="total deny">
              <Prohibit weight="fill" aria-hidden="true" />
              <Trans t={t} i18nKey="settings.totals.deny" values={{ count: totals.deny }} components={{ strong: <strong /> }} />
            </div>
            <span className="scope-hint totals-note">{t("settings.totalsNote")}</span>
          </div>
        )}
        {file && <ScopeSection file={file} draft={draft} />}
      </div>
      <DiffDialog {...flow.dialog} confirmLabel={t("settings.confirm")} />
    </div>
  );
}

function ScopeSection({ file, draft }: { file: SettingsFile; draft: PermissionsDraft | undefined }) {
  const { t } = useTranslation("config");
  return (
    <section className="card scope-section" aria-labelledby={`settings-${file.scope}`}>
      <header className="scope-head">
        <ScopeTag scope={file.scope} />
        <h2 id={`settings-${file.scope}`} className="mono">
          {file.path}
        </h2>
        <span className="scope-hint">{scopeHint(file.scope)}</span>
      </header>
      {draft ? (
        <PermissionsEditor scope={file.scope} draft={draft} />
      ) : !file.exists ? (
        <p className="hint">{t("settings.missingFile")}</p>
      ) : file.error ? (
        <p className="error" role="alert">
          {file.error}
        </p>
      ) : (
        <>
          {file.defaultMode && (
            <p className="mode-line">
              <Trans t={t} i18nKey="settings.defaultMode" values={{ mode: file.defaultMode, label: knownMode(file.defaultMode) ? t(`settings.modeLabel.${file.defaultMode}`) : "" }} components={{ code: <code /> }} />
            </p>
          )}
          <div className="rule-columns">
            <RuleList title={t("settings.column.allow")} tone="allow" rules={file.allow} />
            <RuleList title={t("settings.column.ask")} tone="ask" rules={file.ask} />
            <RuleList title={t("settings.column.deny")} tone="deny" rules={file.deny} />
          </div>
          {file.additionalDirectories.length > 0 && (
            <p className="mode-line">
              {t("settings.extraDirs")}{file.additionalDirectories.map((d) => <code key={d}>{d}</code>)}
            </p>
          )}
          {file.env.length > 0 && (
            <div className="env-table">
              <div className="pane-label">{t("settings.env")}</div>
              {file.env.map((e) => (
                <div key={e.key} className="env-row">
                  <span className="mono">{e.key}</span>
                  <span className={`mono env-value${e.reference ? " is-ref" : ""}`}>{e.value}</span>
                </div>
              ))}
            </div>
          )}
          {file.otherKeys.length > 0 && <p className="hint">{t("settings.other", { keys: file.otherKeys.join(", ") })}</p>}
        </>
      )}
    </section>
  );
}

function RuleList({ title, tone, rules }: { title: string; tone: "allow" | "ask" | "deny"; rules: string[] }) {
  const { t } = useTranslation("config");
  return (
    <div className={`rule-list tone-${tone}`}>
      <div className="rule-list-head">
        {title} <span>{rules.length}</span>
      </div>
      {rules.length === 0 ? (
        <p className="hint">{t("settings.none")}</p>
      ) : (
        <ul>
          {rules.map((r) => (
            <li key={r}>
              <RuleChip rule={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
