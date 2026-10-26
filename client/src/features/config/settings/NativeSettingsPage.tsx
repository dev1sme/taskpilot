import { Eye, PencilSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { clearDraft, configDraftKey, getDraft, isDirty, setDraft, useDrafts } from "../shared/drafts";
import { backupToast, ConfigHeader, ConfigToolbar, LoadError } from "../shared/ConfigChrome";
import { DraftControls, ScopeTabs, ScopeTag, scopeHint } from "../shared/ScopeControls";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import type { Scope } from "../shared/types";
import { settingsApi } from "./api";
import type { NativeCli, NativeFields, NativeValue } from "./types";

interface NativeDraft {
  path: string;
  baseHash: string;
  original: NativeFields;
  changes: NativeFields;
}

const draftKey = (cli: NativeCli, scope: Scope) => configDraftKey(cli, `settings:${scope}`);

const options: Record<string, NativeValue[]> = {
  approval_policy: ["on-request", "never"],
  sandbox_mode: ["read-only", "workspace-write", "danger-full-access"],
  "permissions.disableBypassPermissionsMode": ["disable", "allow-auto-only"],
};

function fieldOptions(key: string, scope: Scope, original: NativeValue): NativeValue[] {
  if (key === "respectGitignore" && scope !== "user") return original === false ? [null, true, false] : [null, true];
  return [null, ...(options[key] ?? [true, false])];
}

function optionValue(value: NativeValue): string {
  return value === null ? "" : String(value);
}

function selectedValue(key: string, raw: string): NativeValue {
  if (!raw) return null;
  return (options[key] ?? [true, false]).find((value) => String(value) === raw) ?? null;
}

/** Only the fields selected in this form are sent to the native settings adapter. */
export function NativeSettingsPage({ cli }: { cli: NativeCli }) {
  const { t } = useTranslation("config");
  const { data, error, loading, reload } = useConfig(["settings", cli], () => settingsApi.nativeSettings(cli));
  const [scope, setScope] = useState<Scope>("project");
  const [opening, setOpening] = useState(false);
  useDrafts();
  const files = data ?? [];
  const file = files.find((item) => item.scope === scope);
  const draft = getDraft<NativeDraft>(draftKey(cli, scope));

  const startEditing = async () => {
    setOpening(true);
    try {
      const detail = await settingsApi.nativeDetail(cli, scope);
      setDraft(draftKey(cli, scope), { path: detail.path, baseHash: detail.hash, original: detail.fields, changes: {} } satisfies NativeDraft);
    } catch (cause) {
      toast((cause as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = useSaveFlow({
    title: t("settings.native.saveTitle", { path: draft?.path ?? file?.path ?? "" }),
    preview: () => settingsApi.nativePreview(cli, scope, draft!.changes, draft!.baseHash),
    save: () => settingsApi.nativeSave(cli, scope, draft!.changes, draft!.baseHash),
    onSaved: () => {
      backupToast(t("settings.native.saved", { path: draft?.path }));
      clearDraft(draftKey(cli, scope));
      void reload();
    },
  });

  const update = (key: string, value: NativeValue) => {
    if (!draft) return;
    const changes = { ...draft.changes };
    if (value === draft.original[key]) delete changes[key];
    else changes[key] = value;
    setDraft(draftKey(cli, scope), { ...draft, changes });
  };

  const actions = draft ? (
    <>
      <DraftControls key={scope} draftKey={draftKey(cli, scope)} />
      <Button icon={Eye} variant="primary" disabled={Object.keys(draft.changes).length === 0} onClick={() => void flow.review()}>
        {t("action.review")}
      </Button>
    </>
  ) : (
    file &&
    !file.error && (
      <Button icon={file.exists ? PencilSimple : Plus} variant="primary" busy={opening} title={t("settings.native.editTitle", { path: file.path })} onClick={() => void startEditing()}>
        {file.exists ? t("action.edit") : t("action.add")}
      </Button>
    )
  );

  return (
    <div className="page">
      <ConfigHeader title={t(`settings.native.${cli}.title`)} subtitle={t(`settings.native.${cli}.subtitle`)} />
      <ConfigToolbar
        start={
          <ScopeTabs
            value={scope}
            onChange={(next) => {
              flow.dialog.onClose();
              setScope(next);
            }}
            label={t("settings.tabsLabel")}
            labels={{
              project: files.find((item) => item.scope === "project")?.path ?? t("scope.label.project"),
              local: files.find((item) => item.scope === "local")?.path ?? t("scope.label.local"),
              user: files.find((item) => item.scope === "user")?.path ?? t("scope.label.user"),
            }}
            scopes={files.map((item) => item.scope)}
            isMissing={(item) => files.find((entry) => entry.scope === item)?.exists === false && !getDraft(draftKey(cli, item))}
            isDirty={(item) => isDirty(draftKey(cli, item))}
          />
        }
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      <div className="page-body settings">
        {file && (
          <section className="card scope-section" aria-labelledby={`settings-${cli}-${scope}`}>
            <header className="scope-head">
              <ScopeTag scope={scope} />
              <h2 id={`settings-${cli}-${scope}`} className="mono">
                {file.path}
              </h2>
              <span className="scope-hint">{scopeHint(scope)}</span>
            </header>
            {file.error ? (
              <p className="error" role="alert">
                {file.error}
              </p>
            ) : (
              <>
                {!file.exists && <p className="hint">{t("settings.native.missingFile")}</p>}
                <div className="native-settings-fields">
                  {file.editableKeys.map((key) => (
                    <NativeField
                      key={key}
                      fieldKey={key}
                      scope={scope}
                      value={draft && key in draft.changes ? draft.changes[key] : (draft?.original[key] ?? file.fields[key] ?? null)}
                      original={draft?.original[key] ?? file.fields[key] ?? null}
                      editing={!!draft}
                      onChange={(value) => update(key, value)}
                    />
                  ))}
                </div>
                <p className="hint">{t("settings.native.fieldsHint")}</p>
              </>
            )}
          </section>
        )}
      </div>
      <DiffDialog {...flow.dialog} confirmLabel={t("settings.native.confirm")} />
    </div>
  );
}

function NativeField({
  fieldKey,
  scope,
  value,
  original,
  editing,
  onChange,
}: {
  fieldKey: string;
  scope: Scope;
  value: NativeValue;
  original: NativeValue;
  editing: boolean;
  onChange: (value: NativeValue) => void;
}) {
  const { t } = useTranslation("config");
  const label = t(`settings.native.field.${fieldKey}`, { defaultValue: fieldKey });
  return (
    <div className="native-settings-field">
      <label htmlFor={editing ? `native-${scope}-${fieldKey}` : undefined}>{label}</label>
      {editing ? (
        <select id={`native-${scope}-${fieldKey}`} value={optionValue(value)} onChange={(event) => onChange(selectedValue(fieldKey, event.target.value))}>
          {fieldOptions(fieldKey, scope, original).map((option) => (
            <option key={optionValue(option)} value={optionValue(option)}>
              {option === null ? t("settings.native.unset") : t(`settings.native.value.${optionValue(option)}`, { defaultValue: optionValue(option) })}
            </option>
          ))}
        </select>
      ) : (
        <span className="mono">{value === null ? t("settings.native.unsetOrUnknown") : t(`settings.native.value.${optionValue(value)}`, { defaultValue: optionValue(value) })}</span>
      )}
      <small>{t(`settings.native.help.${fieldKey}`, { defaultValue: "" })}</small>
    </div>
  );
}
