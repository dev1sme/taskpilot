import { Eye, Robot, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConfigCli } from "../../../shared/router";
import { Button } from "../../../shared/ui/Button";
import { DiffDialog } from "../../../shared/ui/DiffDialog";
import { backupToast } from "../shared/parts";
import { libraryApi } from "./api";
import type { AgentCheck, AgentTemplate } from "./types";
import "../../../shared/ui/dialog.css";
import "../../../shared/ui/icon-button.css";
import "./agents.css";

/** Shown on the agents page when the repo has no agent of its own: TaskPilot's templates are one click away. */
export function NoAgentsBanner({ cli, onInstall }: { cli: ConfigCli; onInstall: () => void }) {
  const { t } = useTranslation("config");
  return (
    <section className="agents-banner" aria-label={t("library.templates.bannerTitle")}>
      <Robot weight="duotone" aria-hidden="true" />
      <div>
        <h2>{t("library.templates.bannerTitle")}</h2>
        <p>{t(cli === "codex" ? "library.templates.codex.bannerBody" : "library.templates.bannerBody")}</p>
      </div>
      <Button variant="primary" onClick={onInstall}>
        {t("library.templates.install")}
      </Button>
    </section>
  );
}

/** Short state of an agent's check, for the list. Problems go in the tooltip; the detail lists them. */
export function CheckPill({ check }: { check: AgentCheck }) {
  const { t } = useTranslation("config");
  const label =
    check.status === "error"
      ? t("library.check.error")
      : check.roles.length === 0
        ? t("library.check.unusable")
        : check.roles.includes("member")
          ? t("library.check.member")
          : t("library.check.leaderOnly");
  return (
    <span className={`check-pill is-${check.status}`} title={check.problems.join("\n") || undefined}>
      {label}
    </span>
  );
}

/** What TaskPilot found in the agent: whether a workflow can use it, as what, and why not. */
export function CheckSection({ cli, check }: { cli: ConfigCli; check: AgentCheck }) {
  const { t } = useTranslation("config");
  return (
    <section className={`agent-check is-${check.status}`} aria-label={t("library.check.title")}>
      <div className="pane-label">{t("library.check.title")}</div>
      <p className="agent-check-status">
        <CheckPill check={check} /> {t(cli === "codex" && check.status === "error" ? "library.check.codexError" : `library.check.status.${check.status}`)}
      </p>
      <p>
        {check.roles.length > 0
          ? t("library.check.roles", { roles: check.roles.map((r) => t(cli === "codex" && r === "leader" ? "library.check.codexLeader" : `library.check.role.${r}`)).join(", ") })
          : t("library.check.noRoles")}
      </p>
      {check.problems.length > 0 && (
        <ul className="agent-check-problems">
          {check.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {check.template && <p className="hint">{t(`library.check.template.${check.template}`)}</p>}
    </section>
  );
}

/**
 * Writes TaskPilot's subagents to the selected CLI's project agent directory. A file the
 * repo already has is only overwritten when ticked; every write leaves a backup.
 */
export function TemplatesDialog(props: { cli: ConfigCli; open: boolean; onClose: () => void; onInstalled: () => void }) {
  const { t } = useTranslation(["config", "common"]);
  const [templates, setTemplates] = useState<AgentTemplate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ diff: string; hashes: Record<string, string> } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Every time the dialog opens it starts from nothing, then loads the list.
  const [seenOpen, setSeenOpen] = useState(false);
  if (seenOpen !== props.open) {
    setSeenOpen(props.open);
    if (props.open) {
      setTemplates(null);
      setError(null);
      setReviewing(false);
      setPreview(null);
    }
  }

  useEffect(() => {
    if (!props.open) return;
    libraryApi
      .agentTemplates(props.cli)
      .then((list) => {
        setTemplates(list);
        // New files are ticked; a file the repo changed is overwritten only when the user asks.
        setChosen(new Set(list.filter((x) => !x.exists).map((x) => x.name)));
      })
      .catch((e: unknown) => setError((e as Error).message));
  }, [props.cli, props.open]);

  const names = (templates ?? []).filter((x) => chosen.has(x.name)).map((x) => x.name);
  const toggle = (name: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  const review = async () => {
    setReviewing(true);
    setPreview(null);
    setError(null);
    try {
      const res = await libraryApi.agentTemplatesPreview(props.cli, names);
      setPreview({ diff: res.diff, hashes: Object.fromEntries(res.files.map((f) => [f.name, f.hash])) });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const install = async () => {
    setBusy(true);
    try {
      const overwrite = (templates ?? []).filter((x) => chosen.has(x.name) && x.exists).map((x) => x.name);
      const res = await libraryApi.agentTemplatesInstall(props.cli, names, overwrite, preview?.hashes ?? {});
      backupToast(t(props.cli === "codex" ? "library.templates.codex.installed" : "library.templates.installed", { count: res.files.length }));
      setReviewing(false);
      props.onInstalled();
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {props.open && !reviewing && (
          <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="templates-title"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
            >
              <header className="dialog-head">
                <div>
                  <h2 id="templates-title">{t("library.templates.title")}</h2>
                  <p className="dialog-sub">{t(props.cli === "codex" ? "library.templates.codex.subtitle" : "library.templates.subtitle")}</p>
                </div>
                <button type="button" className="icon-btn" onClick={props.onClose} aria-label={t("common:close")}>
                  <X weight="bold" />
                </button>
              </header>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {templates === null ? (
                !error && <p className="hint">{t("library.templates.loading")}</p>
              ) : (
                <ul className="template-list">
                  {templates.map((x) => (
                    <li key={x.name}>
                      <label className="template-row">
                        <input type="checkbox" checked={chosen.has(x.name)} disabled={x.same} onChange={(e) => toggle(x.name, e.target.checked)} />
                        <span className="template-text">
                          <span className="mono">{x.name}</span>
                          <span className="template-desc">{x.description}</span>
                          <span className={`template-state${x.exists && !x.same ? " is-warn" : ""}`}>
                            {x.same ? t("library.templates.same") : x.exists ? t("library.templates.modified", { path: x.path }) : t("library.templates.new", { path: x.path })}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <footer className="dialog-actions">
                <Button variant="quiet" onClick={props.onClose}>
                  {t("library.new.cancel")}
                </Button>
                <Button icon={Eye} variant="primary" disabled={names.length === 0} onClick={() => void review()}>
                  {t("library.templates.review", { count: names.length })}
                </Button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <DiffDialog
        open={props.open && reviewing}
        title={t(props.cli === "codex" ? "library.templates.codex.diffTitle" : "library.templates.diffTitle")}
        diff={preview?.diff ?? (error ? "" : null)}
        busy={busy}
        error={error}
        confirmLabel={t("library.templates.write", { count: names.length })}
        onConfirm={() => void install()}
        onClose={() => {
          setReviewing(false);
          setError(null);
        }}
      />
    </>
  );
}
