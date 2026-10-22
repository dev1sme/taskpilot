import { useState } from "react";
import { useTranslation } from "react-i18next";
import { queryClient } from "../../../shared/api/queryClient";
import { toast } from "../../../shared/ui/Toast";
import { clearDraft, getDraft, setDraft, useDrafts } from "../shared/drafts";
import { backupToast } from "../shared/parts";
import { useConfig } from "../shared/useConfig";
import { useSaveFlow } from "../shared/useSaveFlow";
import { workflowConfigApi } from "./api";
import type { WorkflowDraft } from "./types";
import { draftKey, openDraftNames, WORKFLOW_FILE } from "./workflow-files";

/** State and actions of the workflow page. */
export function useWorkflowPage(initialFile: string | undefined) {
  const { t } = useTranslation("config");
  const [viewMode, setViewMode] = useState<string | undefined>();
  const { data, error, loading, reload } = useConfig(["workflow", viewMode], () => workflowConfigApi.get(viewMode));
  const dirty = useDrafts();
  const [picked, setPicked] = useState(initialFile ?? WORKFLOW_FILE);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [adding, setAdding] = useState(false);

  const isOverride = data?.origin === "repo";
  const draftNames = isOverride ? openDraftNames(dirty, picked) : [];
  const draft = getDraft<WorkflowDraft>(draftKey(picked));
  const file = data?.files.find((f) => f.name === picked);
  const newFiles = draftNames.filter((n) => !data?.files.some((f) => f.name === n));

  // Task stages are read from the workflow's documents, so the task list follows every change.
  const refresh = async () => {
    await reload();
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  // A new prompt whose draft was cancelled no longer exists: go back to workflow.yml.
  if (data && !draft && !file && picked !== WORKFLOW_FILE) setPicked(WORKFLOW_FILE);
  // A confirmation belongs to the file it was asked on.
  const [seenPicked, setSeenPicked] = useState(picked);
  if (seenPicked !== picked) {
    setSeenPicked(picked);
    setConfirm(null);
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const createOverride = () =>
    run(async () => {
      const res = await workflowConfigApi.createOverride(data!.mode.id);
      toast(t("workflow.created", { count: res.files.length }));
      await refresh();
    });

  const setDefaultMode = () =>
    run(async () => {
      await workflowConfigApi.setMode(data!.mode.id);
      toast(t("workflow.modes.setDone", { name: data!.mode.name }));
      void queryClient.invalidateQueries({ queryKey: ["workflow-modes"] });
      await refresh();
    });

  const switchMode = (id: string) => {
    setViewMode(id);
    setPicked(WORKFLOW_FILE);
  };

  const reset = () =>
    run(async () => {
      await workflowConfigApi.reset(Object.fromEntries((data?.files ?? []).map((f) => [f.name, f.hash])));
      // Also the drafts of new prompts: they are not in data.files.
      for (const name of new Set([...(data?.files ?? []).map((f) => f.name), ...openDraftNames(dirty, "")])) clearDraft(draftKey(name));
      backupToast(t("workflow.resetDone"));
      setPicked(WORKFLOW_FILE);
      await refresh();
    });

  const removeFile = () =>
    run(async () => {
      await workflowConfigApi.remove(picked, file!.hash);
      backupToast(t("deletedRestorable", { name: file!.path }));
      setPicked(WORKFLOW_FILE);
      await refresh();
    });

  const startEdit = () =>
    run(async () => {
      const raw = await workflowConfigApi.file(picked);
      setDraft(draftKey(picked), { name: picked, path: raw.path, content: raw.content, baseHash: raw.hash, isNew: false } satisfies WorkflowDraft);
    });

  // A draft holding the built-in text: reviewed and saved like any edit, so the diff shows what is lost.
  const restoreDefault = () =>
    run(async () => {
      const raw = await workflowConfigApi.file(picked);
      if (raw.defaultContent === null) return;
      setDraft(draftKey(picked), { name: picked, path: raw.path, content: raw.defaultContent, baseHash: raw.hash, isNew: false } satisfies WorkflowDraft);
    });

  const addPrompt = (name: string) => {
    setDraft(draftKey(name), { name, path: `${data!.overrideDir}/${name}`, content: data!.newPrompt, baseHash: "absent", isNew: true } satisfies WorkflowDraft, null);
    setPicked(name);
    setAdding(false);
  };

  const flow = useSaveFlow({
    title: t(draft?.isNew ? "library.createTitle" : "library.saveTitle", { path: draft?.path ?? "" }),
    preview: () => workflowConfigApi.preview(draft!.name, draft!.content, draft!.baseHash),
    save: () => workflowConfigApi.save(draft!.name, draft!.content, draft!.baseHash),
    onSaved: () => {
      if (draft!.isNew) toast(t("library.created", { path: draft!.path }));
      else backupToast(t("library.saved", { path: draft!.path }));
      clearDraft(draftKey(draft!.name));
      void refresh();
    },
  });

  return {
    data,
    error,
    loading,
    reload,
    refresh,
    isOverride,
    picked,
    setPicked,
    busy,
    confirm,
    setConfirm,
    adding,
    setAdding,
    draft,
    file,
    newFiles,
    flow,
    createOverride,
    setDefaultMode,
    switchMode,
    reset,
    removeFile,
    startEdit,
    restoreDefault,
    addPrompt,
  };
}

export type WorkflowPageState = ReturnType<typeof useWorkflowPage>;
