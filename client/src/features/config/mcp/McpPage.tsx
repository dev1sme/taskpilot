import { CheckCircle, CircleNotch, HourglassMedium, Key, PencilSimple, Plugs, Plus, Trash, Warning, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useWorkspace } from "../../workspace";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/ui/Toast";
import { McpForm } from "./McpForm";
import { ConfigHeader, ConfigToolbar, EmptyCard, LoadError, ScopeTabs, ScopeTag } from "../shared/parts";
import { shadowedBy } from "../shared/precedence";
import { useConfig } from "../shared/useConfig";
import { mcpApi } from "./api";
import type { McpCheck, McpEntryForm, McpServer } from "./types";
import type { Scope } from "../shared/types";
import "../shared/library-view.css";
import "./mcp.css";

type Editing = { scope: Scope; base: McpEntryForm | null; baseHash: string } | null;

/** MCP servers Claude sees for this repo, one scope per tab; add, edit, delete and check them. */
export function McpPage() {
  const { t } = useTranslation("config");
  const tabLabel = (s: Scope) => t(`mcp.tab.${s}`);
  const { data, error, loading, reload } = useConfig(["mcp"], mcpApi.mcp);
  const { reloadInventory } = useWorkspace();
  const [scope, setScope] = useState<Scope>("project");
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  // The form renders its cancel / save buttons into the toolbar.
  const [actionsSlot, setActionsSlot] = useState<HTMLSpanElement | null>(null);
  const all = data?.servers ?? [];
  const servers = all.filter((s) => s.scope === scope);
  const keyOf = (s: McpServer) => `${s.scope}:${s.name}`;
  const current = servers.find((s) => keyOf(s) === picked) ?? servers[0];

  const refresh = () => {
    void reload();
    void reloadInventory();
  };

  const startAdd = async (scope: Scope) => {
    try {
      const { hash } = await mcpApi.mcpAddHash(scope);
      setEditing({ scope, base: null, baseHash: hash });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  const startEdit = async (s: McpServer) => {
    try {
      const form = await mcpApi.mcpEntry(s.scope, s.name);
      setEditing({ scope: s.scope, base: form, baseHash: form.hash });
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <div className="page">
      <ConfigHeader title={t("mcp.title")} subtitle={t("mcp.subtitle")} />
      <ConfigToolbar
        start={
          !editing && (
            <ScopeTabs
              value={scope}
              onChange={setScope}
              label={t("mcp.tabsLabel")}
              labels={{ project: tabLabel("project"), local: tabLabel("local"), user: tabLabel("user") }}
              count={(s) => all.filter((x) => x.scope === s).length}
            />
          )
        }
        loading={loading}
        onReload={refresh}
        actions={
          editing ? (
            <span ref={setActionsSlot} className="toolbar-slot" />
          ) : (
            <Button icon={Plus} variant="primary" title={t("mcp.addTitle", { file: tabLabel(scope) })} onClick={() => void startAdd(scope)}>
              {t("action.add")}
            </Button>
          )
        }
      />
      <LoadError error={error} />
      <div className="page-body">
        {data?.sources
          .filter((s) => s.error && s.scope === scope)
          .map((s) => (
            <p key={s.scope} className="error config-error" role="alert">
              {s.path}: {s.error}
            </p>
          ))}
        {editing ? (
          <McpForm
            scope={editing.scope}
            base={editing.base}
            baseHash={editing.baseHash}
            actionsSlot={actionsSlot}
            onDone={(name) => {
              if (name) {
                setScope(editing.scope);
                setPicked(`${editing.scope}:${name}`);
              }
              setEditing(null);
              refresh();
            }}
          />
        ) : data && servers.length === 0 ? (
          <EmptyCard title={t("mcp.emptyTitle", { file: tabLabel(scope) })}>{t(`mcp.empty.${scope}`)}</EmptyCard>
        ) : (
          <div className="library">
            <ul className="mcp-list" aria-label={t("mcp.listLabel")}>
              {servers.map((s) => {
                const hidden = shadowedBy("mcp", s, all);
                return (
                  <li key={keyOf(s)}>
                    <button
                      type="button"
                      className="mcp-item"
                      aria-current={current && keyOf(current) === keyOf(s) ? "true" : undefined}
                      onClick={() => setPicked(keyOf(s))}
                    >
                      <span className={`mcp-dot${s.error || s.missingEnv.length ? " is-warn" : ""}`} aria-hidden="true" />
                      <span className="mcp-text">
                        <span className="mono mcp-name">{s.name}</span>
                        <span className="mcp-meta">
                          {s.error ? t("mcp.configError") : s.type}
                          {s.missingEnv.length > 0 && t("mcp.missing", { vars: s.missingEnv.join(", ") })}
                        </span>
                      </span>
                      {hidden && (
                        <span className="shadow-pill" title={t("shadow.title", { scope: hidden })}>
                          {t("shadow.pill", { scope: hidden })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {current && (
              <McpDetail
                key={keyOf(current)}
                server={current}
                source={data?.sources.find((x) => x.scope === current.scope)?.path ?? ""}
                onEdit={() => void startEdit(current)}
                onChanged={refresh}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const CHECK_ICON: Record<McpCheck["status"], typeof CheckCircle> = {
  connected: CheckCircle,
  failed: XCircle,
  pending: HourglassMedium,
  auth: Key,
  unknown: Warning,
};

/** Check results with a hint (`config:mcp.checkHint.<status>`). */
const HINTED = ["pending", "auth", "failed"] as const;
const hinted = (s: McpCheck["status"]): s is (typeof HINTED)[number] => (HINTED as readonly string[]).includes(s);

function McpDetail({ server, source, onEdit, onChanged }: { server: McpServer; source: string; onEdit: () => void; onChanged: () => void }) {
  const { t } = useTranslation("config");
  const [check, setCheck] = useState<McpCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await mcpApi.mcpCheck(server.name));
    } catch (e) {
      setCheck({ status: "unknown", label: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const { hash } = await mcpApi.mcpEntry(server.scope, server.name);
      await mcpApi.mcpDelete(server.scope, server.name, hash);
      toast(t("deletedRestorable", { name: server.name }));
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const CheckIcon = check ? CHECK_ICON[check.status] : null;

  return (
    <article className="card library-detail" aria-labelledby="mcp-title">
      <header className="lib-head">
        <h2 id="mcp-title" className="mono">
          {server.name}
        </h2>
        <ScopeTag scope={server.scope} />
        <span className="pill">{server.type}</span>
        <div className="lib-actions">
          <Button icon={Plugs} busy={checking} onClick={() => void runCheck()}>
            {t("mcp.check")}
          </Button>
          <Button icon={PencilSimple} onClick={onEdit}>
            {t("action.edit")}
          </Button>
          {confirmDelete ? (
            <Button icon={Trash} variant="danger" busy={deleting} onClick={() => void remove()}>
              {t("action.deleteConfirm")}
            </Button>
          ) : (
            <Button icon={Trash} variant="quiet" onClick={() => setConfirmDelete(true)}>
              {t("action.delete")}
            </Button>
          )}
        </div>
      </header>
      <p className="mono lib-path">{source}</p>

      {checking && (
        <p className="check-result" role="status">
          <CircleNotch className="spin" aria-hidden="true" /> {t("mcp.checking")}
        </p>
      )}
      {check && CheckIcon && !checking && (
        <div className={`check-result is-${check.status}`} role="status">
          <CheckIcon weight="fill" aria-hidden="true" />
          <span>
            <strong>{check.label}</strong>
            {hinted(check.status) && <span className="check-hint">{t(`mcp.checkHint.${check.status}`)}</span>}
          </span>
        </div>
      )}

      {server.error && (
        <p className="error" role="alert">
          {server.error}
        </p>
      )}
      {server.missingEnv.map((v) => (
        <MissingVar key={v} name={v} onSaved={onChanged} />
      ))}
      {server.fromTaskPilot.length > 0 && (
        <p className="hint">
          <Trans t={t} i18nKey="mcp.fromTaskPilot" values={{ vars: server.fromTaskPilot.join(", ") }} components={{ code: <code /> }} />
        </p>
      )}

      <dl className="fields">
        {server.command && (
          <div>
            <dt>{t("mcp.command")}</dt>
            <dd className="mono">{server.command}</dd>
          </div>
        )}
        {server.args.length > 0 && (
          <div>
            <dt>{t("mcp.args")}</dt>
            <dd className="chips">
              {server.args.map((a, i) => (
                <code key={i} className="chip">
                  {a}
                </code>
              ))}
            </dd>
          </div>
        )}
        {server.url && (
          <div>
            <dt>{t("mcp.url")}</dt>
            <dd className="mono">{server.url}</dd>
          </div>
        )}
      </dl>
      <Values title={t("mcp.env")} values={server.env} missing={server.missingEnv} />
      <Values title={t("mcp.headers")} values={server.headers} missing={server.missingEnv} />
    </article>
  );
}

/** A ${VAR} nobody sets: let the user give TaskPilot's sessions a value for it. */
function MissingVar({ name, onSaved }: { name: string; onSaved: () => void }) {
  const { t } = useTranslation("config");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="alert-warn missing-var"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await mcpApi.envSet(name, value);
          toast(t("mcp.envSaved", { name }));
          setValue("");
          onSaved();
        } catch (err) {
          toast((err as Error).message, { error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Warning weight="fill" aria-hidden="true" />
      <div className="missing-body">
        <label htmlFor={`env-${name}`}>
          <Trans t={t} i18nKey="mcp.missingVar" values={{ name }} components={{ code: <code /> }} />
        </label>
        <div className="missing-row">
          <input id={`env-${name}`} type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" placeholder={t("mcp.valuePlaceholder")} />
          <Button type="submit" busy={busy} disabled={!value}>
            {t("action.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Values({ title, values, missing }: { title: string; values: McpServer["env"]; missing: string[] }) {
  const { t } = useTranslation("config");
  if (values.length === 0) return null;
  return (
    <div className="env-table">
      <div className="pane-label">{title}</div>
      {values.map((v) => {
        const unset = v.reference && missing.some((m) => v.value.includes(m));
        return (
          <div key={v.key} className="env-row">
            <span className="mono">{v.key}</span>
            <span className={`mono env-value${v.reference ? " is-ref" : ""}${unset ? " is-unset" : ""}`}>
              {v.value}
              {unset && t("mcp.unset")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
