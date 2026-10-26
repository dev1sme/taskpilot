import { Eye, PencilSimple, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { toast } from "../../../shared/ui/Toast";
import { clearDraft, configDraftKey, dirtyKeys, getDraft, isDirty, setDraft, useDrafts } from "../shared/drafts";
import { backupToast, ConfigHeader, ConfigToolbar, EmptyCard, LoadError } from "../shared/ConfigChrome";
import { DraftControls, ScopeTabs } from "../shared/ScopeControls";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import { hooksApi } from "./api";
import { CopilotHooksEditor } from "./CopilotHooksEditor";
import type { CopilotHookInput } from "./types";

type HookScope = "project" | "user";

interface CopilotDraft {
  path: string;
  hash: string;
  hooks: CopilotHookInput[];
}

const draftKey = (scope: HookScope, name: string) => configDraftKey("copilot", `hooks:${name}:${scope}`);
const validName = (name: string) => /^[A-Za-z0-9][\w.-]*\.json$/.test(name) && name !== "taskpilot.json";

/** File based hooks used by Copilot CLI. Only validated command entries are editable. */
export function CopilotHooksPage() {
  const { t } = useTranslation("config");
  const [scope, setScope] = useState<HookScope>("project");
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [opening, setOpening] = useState(false);
  const { data, error, loading, reload } = useConfig(["hooks-files", "copilot"], hooksApi.copilotFiles);
  useDrafts();
  const files = (data ?? []).filter((file) => file.scope === scope);
  const draft = selected ? getDraft<CopilotDraft>(draftKey(scope, selected)) : undefined;

  const open = async (name: string, create: boolean) => {
    if (getDraft<CopilotDraft>(draftKey(scope, name))) {
      setSelected(name);
      return;
    }
    setOpening(true);
    try {
      const detail = await hooksApi.copilotDetail(scope, name);
      if (create && detail.exists) {
        toast(t("hooks.copilot.alreadyExists"), { error: true });
        return;
      }
      setSelected(name);
      setDraft(draftKey(scope, name), { path: detail.path, hash: detail.hash, hooks: detail.hooks });
      if (create) setNewName("");
    } catch (cause) {
      toast((cause as Error).message, { error: true });
    } finally {
      setOpening(false);
    }
  };

  const flow = useSaveFlow({
    title: t("hooks.saveTitle", { path: draft?.path ?? "" }),
    preview: () => hooksApi.copilotPreview(scope, selected!, draft!.hooks, draft!.hash),
    save: () => hooksApi.copilotSave(scope, selected!, draft!.hooks, draft!.hash),
    onSaved: () => {
      backupToast(t("hooks.saved", { path: draft?.path }));
      clearDraft(draftKey(scope, selected!));
      void reload();
    },
  });

  const actions =
    draft && selected ? (
      <>
        <DraftControls key={`${scope}:${selected}`} draftKey={draftKey(scope, selected)} />
        <Button icon={Eye} variant="primary" disabled={!isDirty(draftKey(scope, selected))} onClick={() => void flow.review()}>
          {t("action.review")}
        </Button>
      </>
    ) : null;

  return (
    <div className="page">
      <ConfigHeader title={t("hooks.copilot.title")} subtitle={t("hooks.copilot.subtitle")} />
      <ConfigToolbar
        start={
          <ScopeTabs<HookScope>
            value={scope}
            onChange={(next) => {
              flow.dialog.onClose();
              setScope(next);
              setSelected(null);
            }}
            label={t("hooks.copilot.scopesLabel")}
            labels={{ project: t("scope.label.project"), user: t("scope.label.user") }}
            scopes={["project", "user"]}
            count={(item) => (data ?? []).filter((file) => file.scope === item).length}
            isDirty={(item) => dirtyKeys().some((key) => key.startsWith("copilot:hooks:") && key.endsWith(`:${item}`))}
          />
        }
        loading={loading}
        onReload={() => void reload()}
        actions={actions}
      />
      <LoadError error={error} />
      <div className="page-body hooks">
        <p className="hint">{t("hooks.copilot.projectionHint")}</p>
        <section className="card copilot-hooks-files" aria-label={t("hooks.copilot.filesLabel")}>
          <h2>{t("hooks.copilot.filesLabel")}</h2>
          {files.length === 0 && <EmptyCard title={t("hooks.copilot.emptyTitle")}>{t("hooks.copilot.emptyBody")}</EmptyCard>}
          {files.map((file) => (
            <div key={file.name} className="copilot-hook-file">
              <div>
                <strong className="mono">{file.path}</strong>
                <p className={file.error ? "error" : "hint"}>{file.error ?? t("hooks.copilot.commandCount", { count: file.hooks.length })}</p>
              </div>
              {!file.error && (
                <Button icon={PencilSimple} variant="quiet" busy={opening && selected === file.name} onClick={() => void open(file.name, false)}>
                  {t("action.edit")}
                </Button>
              )}
            </div>
          ))}
          <div className="copilot-hook-create">
            <label htmlFor="copilot-hook-name">{t("hooks.copilot.newFile")}</label>
            <input id="copilot-hook-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="my-hooks.json" spellCheck={false} />
            <Button icon={Plus} variant="quiet" disabled={!validName(newName) || files.some((file) => file.name === newName)} busy={opening} onClick={() => void open(newName, true)}>
              {t("action.add")}
            </Button>
          </div>
          {newName && !validName(newName) && <p className="hint">{t("hooks.copilot.nameHint")}</p>}
        </section>
        {draft && selected && <CopilotHooksEditor path={draft.path} hooks={draft.hooks} onChange={(hooks) => setDraft(draftKey(scope, selected), { ...draft, hooks })} />}
      </div>
      <DiffDialog {...flow.dialog} confirmLabel={t("hooks.confirm")} />
    </div>
  );
}
